// v6 — Strict org-fallback: rescue only when the namespace is a real Organization
// (NOT a user) AND has at least one public repository. Filters out squatted usernames
// like 'sky-protocol' that exist but are empty/random.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

type Status = "valid" | "invalid" | "error";
function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}
async function ghFetch(path: string, ghToken: string | null): Promise<{ status: number; json?: any }> {
  const headers: Record<string, string> = { "User-Agent": "AuditScope-Verifier/6.0", "Accept": "application/vnd.github+json" };
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
  try {
    const r = await fetch(`https://api.github.com${path}`, { method: "GET", headers, redirect: "follow" });
    if (r.status === 200) { try { return { status: 200, json: await r.json() }; } catch { return { status: 200 }; } }
    return { status: r.status };
  } catch { return { status: 0 }; }
}
function statusFromCode(c: number): Status {
  if (c === 200) return "valid";
  if (c === 404 || c === 410 || c === 422) return "invalid";
  return "error";
}

// STRICT: only rescue when namespace is type=Organization with public_repos > 0.
async function checkOrgFallback(name: string, ghToken: string | null): Promise<Status> {
  const org = await ghFetch(`/orgs/${name}`, ghToken);
  if (org.status === 200 && org.json) {
    const type = org.json.type;            // "Organization"
    const publicRepos = Number(org.json.public_repos ?? 0);
    if (type === "Organization" && publicRepos > 0) return "valid";
    return "invalid";  // org exists but empty/wrong-type — NOT useful as a fallback
  }
  if (org.status === 404) return "invalid";  // user accounts intentionally skipped
  return "error";
}

async function verifyAndRepair(repoUrl: string, hash: string | null, ghToken: string | null) {
  const parsed = parseRepo(repoUrl);
  if (!parsed) return { repo: "invalid" as Status, commit: hash ? "invalid" as Status : null, org: null as Status | null };
  const direct = await ghFetch(`/repos/${parsed.owner}/${parsed.repo}`, ghToken);
  if (direct.status === 200) {
    const actualFullName: string | undefined = direct.json?.full_name;
    let finalOwner = parsed.owner, finalRepo = parsed.repo;
    let newRepoUrl: string | undefined;
    if (actualFullName && actualFullName.toLowerCase() !== `${parsed.owner}/${parsed.repo}`.toLowerCase()) {
      const np = actualFullName.split("/");
      if (np.length === 2) {
        finalOwner = np[0]; finalRepo = np[1];
        newRepoUrl = `https://github.com/${finalOwner}/${finalRepo}`;
      }
    }
    let commit: Status | null = null;
    if (hash) {
      if (!/^[a-f0-9]{7,64}$/i.test(hash)) commit = "invalid";
      else {
        const c = await ghFetch(`/repos/${finalOwner}/${finalRepo}/commits/${hash}`, ghToken);
        commit = statusFromCode(c.status);
      }
    }
    return { repo: "valid" as Status, commit, newRepoUrl, rescuedVia: newRepoUrl ? "redirect" as const : undefined, org: "valid" as Status };
  }
  if (direct.status === 404 || direct.status === 410) {
    const orgStatus = await checkOrgFallback(parsed.owner, ghToken);
    return { repo: "invalid" as Status, commit: hash ? "invalid" as Status : null, org: orgStatus };
  }
  return { repo: statusFromCode(direct.status), commit: hash ? statusFromCode(direct.status) : null, org: null };
}


// ---------------------------------------------------------------------------
// Discovery mode.
//
// The modes above only VALIDATE a repo URL that is already on the row; they
// never find one. Discovery reads the report itself and extracts the repository
// the report states was audited, then puts that candidate through the exact
// same verifyAndRepair() check as everything else. A candidate is only written
// once GitHub answers 200 for it -- a repo is never asserted from a name.
//
// Pashov reports carry an unambiguous block:
//   **Review commit hash:**<br>o [<sha>](https://github.com/OWNER/REPO/tree/<sha>)
// Anchoring on that marker matters: the body of a report links plenty of other
// repos (OpenZeppelin, Uniswap) that are references, not the audited code.
function rawify(u: string): string {
  return u.replace("https://github.com/", "https://raw.githubusercontent.com/")
          .replace("/blob/", "/");
}

type Found = { repo: string; hash: string | null } | null;

function extractFromReport(md: string): Found {
  // 1. The explicit "Review commit hash" marker, first occurrence only. The
  //    "Fixes review commit hash" block names the same repo at a later commit.
  // The marker is written several ways across the corpus:
  //   **Review commit hash:**  |  _review commit hash_ -  |  **_review commit hash_ -**
  // so match the words and allow surrounding emphasis. The lookbehind keeps us
  // off "fixes review commit hash", which names the same repo at a later commit.
  const marker = /(?<!fixes[\s_*-]{0,4})review commit hash[\s_*:-]{0,6}([\s\S]{0,600})/i.exec(md);
  if (marker) {
    const m = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/tree\/([a-f0-9]{7,64})/i.exec(marker[1]);
    if (m) return { repo: `https://github.com/${m[1]}/${m[2]}`, hash: m[3] };
  }
  // 2. Code4rena reports name the contest repository in their Scope section:
  //    "The code under review can be found within the [... contest repository]
  //    (https://github.com/code-423n4/2022-07-yield)". That repo holds the
  //    audited source, and it is what the 336 already-verified C4 rows point
  //    to, so this stays consistent with the existing corpus. The closing paren
  //    is required so issue/blob links are not mistaken for the repo root.
  const c4 = /code under review[\s\S]{0,300}?\]\(\s*(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*\)/i.exec(md);
  if (c4) return { repo: c4[1].replace(/\.git$/, ""), hash: null };

  // 3. Scope prose: "a security review of the <strong>OWNER/REPO</strong> repository".
  const scope = /review of the\s*(?:<strong>)?\s*([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\s*(?:<\/strong>)?\s*repositor/i.exec(md);
  if (scope) return { repo: `https://github.com/${scope[1]}/${scope[2]}`, hash: null };
  return null;
}


// ---------------------------------------------------------------------------
// PDF reports.
//
// Probe result: unpdf extracts a 33-page / 930KB Sherlock report in ~410ms in
// this runtime at $0, and Sherlock reports carry a structured scope block:
//     Scope
//     Repository: OWNER/REPO        (sometimes a full github URL)
//     Branch: main
//     Commit: <40 hex>
// naming the PROTOCOL's own repo, not the contest repo. 11 of 13 sampled
// reports matched that block; the other two used older prose variants that the
// patterns below also cover.
//
// CyberScope (1/12) and TechRate (0/10) are deliberately NOT wired up: their
// reports identify a deployed token by contract address and never name a
// repository, so there is nothing to extract.
//
// PDF text wraps at a fixed width, which splits URLs and 40-char hashes across
// lines, so everything is matched against whitespace-collapsed text and the
// hash has its inner spaces stripped after capture.
// Only the first pages are read. Extracting whole reports (some are 33 pages /
// 1MB) at concurrency 3 exhausted the edge worker -- WORKER_RESOURCE_LIMIT --
// and it is wasted work regardless: the scope block is always in the front
// matter, and reading the findings body would only pull in per-issue links to
// other repos that are references rather than the audited code.
const PDF_PAGES = 4;
async function pdfText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "AuditScope-Verifier/6.0" } });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const { getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
    const doc = await getDocumentProxy(bytes);
    const pages = Math.min(doc.numPages ?? 1, PDF_PAGES);
    let out = "";
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out += (tc.items as Array<{ str?: string }>).map((it) => it.str ?? "").join(" ") + "\n";
      if (typeof (page as any).cleanup === "function") (page as any).cleanup();
    }
    if (typeof (doc as any).destroy === "function") await (doc as any).destroy();
    return out;
  } catch { return null; }
}

function ownerRepoFrom(v: string): string | null {
  const s2 = v.trim().replace(/[),.;]+$/, "");
  const m = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i.exec(s2);
  if (m) return `${m[1]}/${m[2]}`.replace(/\.git$/, "");
  const p = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(s2);
  if (p) return `${p[1]}/${p[2]}`;
  return null;
}

function extractFromPdf(raw: string): Found {
  const flat = raw.replace(/\s+/g, " ");
  const hashOf = (m: RegExpExecArray | null) =>
    m ? m[1].replace(/\s+/g, "").slice(0, 40) : null;
  const commit = hashOf(/Commit:?\s*([a-f0-9](?:[a-f0-9]|\s){38,60})/i.exec(flat));

  // 1. Explicit Repository: field (bare owner/repo or a full URL).
  const rep = /Repositor(?:y|ies):\s*(\S+)/i.exec(flat);
  if (rep) {
    const or = ownerRepoFrom(rep[1]);
    if (or) return { repo: `https://github.com/${or}`, hash: commit };
  }
  // 2. "Branch: Master (https://github.com/OWNER/REPO)"
  const br = /Branch:[^(]{0,40}\((https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)[^)]*\)/i.exec(flat);
  if (br) {
    const or = ownerRepoFrom(br[1]);
    if (or) return { repo: `https://github.com/${or}`, hash: commit };
  }
  // 3. Prose: "contracts in the OWNER/REPO @ <hash> repo are in scope"
  const prose = /in the ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*@\s*([a-f0-9](?:[a-f0-9]|\s){38,60})/i.exec(flat);
  if (prose) {
    const or = ownerRepoFrom(prose[1]);
    if (or) return { repo: `https://github.com/${or}`, hash: prose[2].replace(/\s+/g, "").slice(0, 40) };
  }
  return null;
}


// ---------------------------------------------------------------------------
// Address discovery (CyberScope / TechRate).
//
// These firms audit a DEPLOYED token contract, not a codebase: their reports
// name a contract address and never a repository (probe: CyberScope 1/12,
// TechRate 0/10 mention a repo). The audited artefact is therefore an address,
// and each firm states it in its own structured way.
//
// CyberScope: a labelled block
//      Address
//      0x6f5C...
//      Network
//      BSC
// TechRate: a block-explorer link, where the DOMAIN carries the chain and the
//      path carries the address -- bscscan.com/address/0x2e44...
//      /tx/ links are excluded: those are transaction hashes, not contracts.
//
// Nothing is inferred from a project name, and nothing is written as verified:
// rows land in chain_addresses unchecked, and collect-contract-metadata proves
// each one on-chain with eth_getCode.
const EXPLORER_CHAIN: Record<string, string> = {
  "etherscan.io": "ethereum", "bscscan.com": "bsc", "polygonscan.com": "polygon",
  "arbiscan.io": "arbitrum", "snowtrace.io": "avalanche", "ftmscan.com": "fantom",
  "basescan.org": "base", "optimistic.etherscan.io": "optimism", "cronoscan.com": "cronos",
};
// CyberScope's Network field uses short labels.
const NETWORK_LABEL: Record<string, string> = {
  ETH: "ethereum", ETHEREUM: "ethereum", BSC: "bsc", BNB: "bsc", BINANCE: "bsc",
  AVAX: "avalanche", AVALANCHE: "avalanche", POLYGON: "polygon", MATIC: "polygon",
  ARBITRUM: "arbitrum", ARB: "arbitrum", BASE: "base", OPTIMISM: "optimism", OP: "optimism",
  FANTOM: "fantom", FTM: "fantom", CRONOS: "cronos",
};

// Placeholders and precompiles: 0x0..0, 0x1..1, and the low 0x0000..00NN range
// that every chain reserves. None of these is an audited contract.
function isPlaceholderAddress(a: string): boolean {
  const h = a.slice(2).toLowerCase();
  if (/^0+$/.test(h)) return true;
  if (/^(.)\1{39}$/.test(h)) return true;          // 0xffff... / 0x1111...
  if (/^0{30,}[0-9a-f]{0,10}$/.test(h)) return true; // precompile range
  if (/^10{20,}/.test(h)) return true;              // 0x1000000... placeholders
  return false;
}

type AddrHit = { address: string; chain: string; label: string | null };

function extractAddresses(raw: string): AddrHit[] {
  const flat = raw.replace(/\s+/g, " ");
  const out: AddrHit[] = [];
  const seen = new Set<string>();
  const push = (address: string, chain: string, label: string | null) => {
    const key = `${chain}:${address.toLowerCase()}`;
    if (seen.has(key)) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;   // base58/Solana skipped in v1
    if (isPlaceholderAddress(address)) return;
    seen.add(key);
    out.push({ address: address.toLowerCase(), chain, label });
  };

  // CyberScope: "Address <addr> ... Network <label>". The network label governs
  // every address in the document, so it is resolved first.
  const netM = /\bNetwork\b\s*:?\s*([A-Za-z]+(?:\s+TESTNET)?)/i.exec(flat);
  const netRaw = netM ? netM[1].trim().toUpperCase() : null;
  // Testnet deployments are excluded outright: mainnet eth_getCode would report
  // "not a contract" and record a false negative.
  const isTestnet = !!netRaw && /TESTNET|TEST\b|GOERLI|SEPOLIA|MUMBAI/i.test(netRaw);
  const cyberChain = !isTestnet && netRaw ? NETWORK_LABEL[netRaw.split(" ")[0]] ?? null : null;
  if (cyberChain) {
    const addrM = /\bAddress\b\s*:?\s*(0x[a-fA-F0-9]{40})/i.exec(flat);
    if (addrM) push(addrM[1], cyberChain, "audited_contract");
  }

  // TechRate: explorer links. /address/ and /token/ are contracts; /tx/ is not.
  //
  // These URLs wrap mid-address in the PDF text
  // ("/address/0x2a0f...4651e\n2160de#code"), so they are matched against a
  // whitespace-REMOVED copy rather than the space-collapsed one used above.
  // The domain + /address/ prefix must still match immediately before the
  // hex run, so joining lines cannot conjure an address out of loose text.
  const squished = raw.replace(/\s+/g, "");
  const re = /(?:https?:\/\/)?(?:www\.)?([a-z0-9.]*?(?:etherscan\.io|bscscan\.com|polygonscan\.com|arbiscan\.io|snowtrace\.io|ftmscan\.com|basescan\.org|cronoscan\.com))\/(address|token)\/(0x[a-fA-F0-9]{40})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(squished)) !== null) {
    const host = m[1].toLowerCase();
    const chain = EXPLORER_CHAIN[host] ?? EXPLORER_CHAIN[host.replace(/^[a-z0-9]+\./, "")] ?? null;
    if (!chain) continue;
    if (isTestnet) continue;
    push(m[3], chain, m[2] === "token" ? "token_contract" : "audited_contract");
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ghToken = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("GH_TOKEN") || null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; retry_invalid?: boolean; backfill_org?: boolean; revalidate_org?: boolean; commit_backfill?: boolean; discover_firm?: string; discover_ext?: "md" | "pdf"; discover_addresses?: string; discover_c4_api?: boolean; dry_run?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

  // ---- discover_c4_api -----------------------------------------------------
  // Code4rena publishes every contest through its own paginated JSON API
  // (code4rena.com/api/v1/audits), keyless and free, and each entry states the
  // audited code repo AND the findings repo as first-class fields. Our C4 rows
  // carry the findings repo in report_url, so the findings repo is the join key
  // and C4's own answer supplies audited_repo_url — an authoritative identifier,
  // not a name guess.
  //
  // Two conventions were tested and deliberately NOT used as shortcuts:
  //   repo == github.com/code-423n4/<contest slug>  is wrong for 366 of 475.
  //   findingsRepo == repo + "-findings"            is wrong for 9 of 456
  //     (2023-06-angle-findings points at 2022-01-dev-test-repo; the two GTE
  //     contests share one findings repo).
  // So the mapping is read from the API per contest and never reconstructed.
  if (body.discover_c4_api) {
    const dryRun = body.dry_run === true;
    const norm = (u: string) => u.toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
    const ghName = (u: string) => {
      const m = norm(u).match(/code-423n4\/([a-z0-9._-]+)/);
      return m ? m[1] : null;
    };

    // 1. Page the API to exhaustion, driven by its own pagination block.
    const contests: Array<{ slug: string; repo: string | null; findingsRepo: string | null; startTime: string | null; endTime: string | null; status: string | null; auditType: string | null }> = [];
    let page = 1, lastPage = 1, apiErrors = 0;
    while (page <= lastPage && page <= 40) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const r = await fetch(`https://code4rena.com/api/v1/audits?page=${page}`, {
            headers: { Accept: "application/json", "User-Agent": "auditscope-c4-mapper" },
          });
          if (!r.ok) { apiErrors++; break; }
          const j = await r.json();
          const arr = j?.data?.audits;
          if (!Array.isArray(arr)) { apiErrors++; break; }
          for (const a of arr) {
            if (!a?.slug) continue;
            contests.push({
              slug: String(a.slug),
              repo: a.repo ? String(a.repo) : null,
              findingsRepo: a.findingsRepo ? String(a.findingsRepo) : null,
              startTime: a.startTime ? String(a.startTime) : null,
              endTime: a.endTime ? String(a.endTime) : null,
              status: a.status ? String(a.status) : null,
              auditType: a.auditType ? String(a.auditType) : null,
            });
          }
          lastPage = Number(j?.pagination?.lastPage) || lastPage;
          ok = true;
        } catch { apiErrors++; }
      }
      if (!ok) break;
      page++;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (contests.length === 0) return json(200, { ok: false, mode: "discover_c4_api", error: "api_returned_no_contests", api_errors: apiErrors });

    // 2. Index by findings-repo name, and by code-repo name as a fallback for
    //    the 19 contests that have no findings repo. A name claimed by two
    //    different code repos is dropped rather than guessed at.
    //    C4's own API carries a few bad rows, and trusting the field blindly
    //    would import their error as our data: 2023-06-angle-findings points at
    //    2022-01-dev-test-repo, and 2021-04-meebits-findings at 2021-04-redacted.
    //    So a pair must share at least one name token that is not a bare number
    //    — a shared year or month proves nothing. That rejects both of those
    //    while still accepting genuine renames (2021-04-basedloans-findings ->
    //    basedloans, ...-mitigation-findings -> ...-mitigation-contest).
    const nameTokens = (s: string) =>
      new Set(s.split(/[-_.]+/).filter((tok) => tok && tok !== "findings" && !/^\d+$/.test(tok)));
    const plausiblePair = (findingsKey: string, repoKey: string) => {
      if (findingsKey === repoKey + "-findings" || findingsKey === repoKey) return true;
      const a = nameTokens(findingsKey), b = nameTokens(repoKey);
      for (const tok of a) if (b.has(tok)) return true;
      return false;
    };

    const byFindings = new Map<string, string>();
    const ambiguous = new Set<string>();
    let rejectedImplausible = 0;
    const rejectedSamples: any[] = [];
    for (const c of contests) {
      if (!c.repo) continue;
      const repoKey = ghName(c.repo);
      if (!repoKey) continue;
      for (const key of [c.findingsRepo ? ghName(c.findingsRepo) : null, repoKey]) {
        if (!key) continue;
        if (!plausiblePair(key, repoKey)) {
          rejectedImplausible++;
          if (rejectedSamples.length < 10) rejectedSamples.push({ findings_key: key, repo: c.repo, slug: c.slug });
          continue;
        }
        const prior = byFindings.get(key);
        if (prior && norm(prior) !== norm(c.repo)) { ambiguous.add(key); continue; }
        byFindings.set(key, c.repo);
      }
    }
    for (const k of ambiguous) byFindings.delete(k);

    // 3. Only fill rows that have no repo yet. Existing values are left alone:
    //    overwriting a verified link on the strength of a fresh source is not
    //    this pass's job.
    const { data: targets, error: terr } = await admin.from("audit_history")
      .select("id, report_url, audited_repo_url")
      .eq("audit_firm", "Code4rena")
      .is("audited_repo_url", null)
      .limit(2000);
    if (terr) return json(500, { error: terr.message });

    let matched = 0, unmatched = 0, updated = 0, ambiguousHits = 0;
    const samples: any[] = [];
    for (const row of (targets ?? []) as Array<{ id: string; report_url: string | null }>) {
      if (!row.report_url) { unmatched++; continue; }
      const key = ghName(row.report_url);
      if (!key) { unmatched++; continue; }
      if (ambiguous.has(key)) { ambiguousHits++; unmatched++; continue; }
      const repo = byFindings.get(key);
      if (!repo) { unmatched++; continue; }
      matched++;
      if (samples.length < 10) samples.push({ report_url: row.report_url, key, repo });
      if (dryRun) continue;
      const { error } = await admin.from("audit_history")
        // Status intentionally left null, not "valid": C4's API is authoritative
        // for WHICH repo a contest audited, but says nothing about whether the
        // URL still resolves on GitHub. The normal verification pass checks
        // that, so these enter the queue like any other discovered repo.
        .update({ audited_repo_url: repo, repo_url_status: null })
        .eq("id", row.id);
      if (!error) updated++;
    }

    return json(200, {
      ok: true, mode: "discover_c4_api", dry_run: dryRun,
      contests: contests.length, pages_read: page - 1, api_errors: apiErrors,
      mapping_keys: byFindings.size, ambiguous_keys: ambiguous.size,
      rejected_implausible: rejectedImplausible, rejected_samples: rejectedSamples,
      candidates: (targets ?? []).length, matched, unmatched, ambiguous_hits: ambiguousHits, updated,
      samples,
    });
  }

  if (body.discover_addresses) {
    const firm = body.discover_addresses;
    const { data: targets, error: terr } = await admin.from("audit_history")
      .select("id, report_url, company_slug")
      .eq("audit_firm", firm)
      .not("report_url", "is", null)
      .not("company_slug", "is", null)   // chain_addresses.company_slug is NOT NULL
      .ilike("report_url", "*.pdf")
      .is("address_extraction_status", null)
      .limit(limit);
    if (terr) return json(500, { error: terr.message });
    if (!targets || targets.length === 0) return json(200, { ok: true, scanned: 0, note: "no address candidates" });

    // contract_address_blacklist holds generic infrastructure tokens -- USDC,
    // USDT, DAI, WETH, WBTC, stETH and friends. A report naming one of those is
    // naming a dependency, not the audited contract, so attributing it to the
    // client would put someone else's token on their record. Nothing in the
    // codebase consulted this table before, which is why 33 such rows had
    // already accumulated from other sources.
    const blacklist = new Set<string>();
    {
      const { data: bl } = await admin.from("contract_address_blacklist").select("address, chain");
      for (const b of (bl ?? []) as Array<{ address: string; chain: string }>) {
        if (b.address && b.chain) blacklist.add(`${b.chain.toLowerCase()}:${b.address.toLowerCase()}`);
      }
    }

    let withAddr = 0, inserted = 0, none = 0, unfetchable = 0, blacklisted = 0;
    for (const t of targets as any[]) {            // serial: PDF work is memory-bound
      const raw = await pdfText(rawify(t.report_url));
      if (raw === null) {
        unfetchable++;
        await admin.from("audit_history").update({ address_extraction_status: "report_unfetchable" }).eq("id", t.id);
        continue;
      }
      const allHits = extractAddresses(raw);
      const before = allHits.length;
      const hits = allHits.filter((h) => !blacklist.has(`${h.chain.toLowerCase()}:${h.address.toLowerCase()}`));
      blacklisted += before - hits.length;
      if (hits.length === 0) {
        none++;
        await admin.from("audit_history").update({ address_extraction_status: "no_address_in_report" }).eq("id", t.id);
        continue;
      }
      withAddr++;
      // Written UNVERIFIED on purpose: metadata_checked_at stays null so
      // collect-contract-metadata proves each one with eth_getCode. Extraction
      // is evidence that the report named it, not that it exists on chain.
      const rows = hits.map((h) => ({
        company_slug: t.company_slug,
        chain: h.chain,
        address: h.address,
        kind: "unknown",
        label: h.label,
        source: "audit_report_extraction",
        enabled: true,
      }));
      const r = await fetch(`${supabaseUrl}/rest/v1/chain_addresses?on_conflict=company_slug,chain,address`, {
        method: "POST",
        headers: {
          apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (r.ok) inserted += rows.length;
      await admin.from("audit_history").update({
        address_extraction_status: r.ok ? "addresses_extracted" : "insert_failed",
      }).eq("id", t.id);
    }
    return json(200, {
      ok: true, mode: "discover_addresses", firm, scanned: targets.length,
      reports_with_addresses: withAddr, address_rows_written: inserted,
      no_address_in_report: none, report_unfetchable: unfetchable,
      blacklisted_addresses_skipped: blacklisted,
      note: "rows written unverified; collect-contract-metadata proves them on-chain",
    });
  }

  if (body.discover_firm) {
    const { data: targets, error: terr } = await admin.from("audit_history")
      .select("id, report_url")
      .eq("audit_firm", body.discover_firm)
      .not("report_url", "is", null)
      .or(
        (body as any).discover_ext === "md" ? "report_url.ilike.*.md"
        : (body as any).discover_ext === "pdf" ? "report_url.ilike.*.pdf"
        : "report_url.ilike.*.md,report_url.ilike.*.pdf",
      )
      .is("repo_url_status", null)
      .limit(limit);
    if (terr) return json(500, { error: terr.message });
    if (!targets || targets.length === 0) return json(200, { ok: true, scanned: 0, note: "no discovery candidates" });

    let found = 0, written = 0, invalid = 0, noEvidence = 0, fetchFail = 0;
    // PDF work is memory-bound, markdown is not. Test EVERY target, not just
    // the first: a firm with mixed .md/.pdf reports (QuillAudits) otherwise
    // picks concurrency from a leading markdown row and then runs PDFs three at
    // a time, which trips WORKER_RESOURCE_LIMIT.
    const hasPdf = targets.some((t: any) => /\.pdf($|\?)/i.test(String(t.report_url ?? "")));
    const PAR = hasPdf ? 1 : 3;
    for (let i = 0; i < targets.length; i += PAR) {
      const chunk = targets.slice(i, i + PAR);
      await Promise.all(chunk.map(async (t: any) => {
        const src = rawify(t.report_url);
        const isPdf = /\.pdf($|\?)/i.test(src);
        let hit: Found = null;
        let unfetchable = false;
        if (isPdf) {
          const raw = await pdfText(src);
          if (raw === null) unfetchable = true;
          else hit = extractFromPdf(raw);
        } else {
          let md: string | null = null;
          try {
            const r = await fetch(src, { headers: { "User-Agent": "AuditScope-Verifier/6.0" } });
            if (r.ok) md = await r.text();
          } catch { /* handled below */ }
          if (md === null) unfetchable = true;
          else hit = extractFromReport(md);
        }

        if (unfetchable) {
          // Many older Code4rena report.md files have been removed from their
          // contest repo, but the repo itself still resolves -- and for C4 the
          // contest repo IS the audited code, which is what 336 of the 343
          // already-verified C4 rows point to. The report URL is an authoritative
          // location, not a name guess, so it can stand in for the report body.
          //
          // Excluded: *-findings / *-mitigation-findings repos. Those hold the
          // findings, not the audited code, and the code repo they review is not
          // published separately -- calling a findings repo "the audited
          // repository" would misstate what we verified.
          // Both hosts appear in the corpus; raw.githubusercontent.com does NOT
          // contain the substring "github.com", so it must be matched explicitly.
          const m = /(?:raw\.githubusercontent\.com|github\.com)\/(code-423n4)\/([A-Za-z0-9_.-]+)/i.exec(t.report_url);
          const repoName = m ? m[2] : null;
          if (repoName && !/findings/i.test(repoName)) {
            const cand = `https://github.com/${m![1]}/${repoName}`;
            const v2 = await verifyAndRepair(cand, null, ghToken);
            if (v2.repo === "valid") {
              await admin.from("audit_history").update({
                audited_repo_url: v2.newRepoUrl || cand,
                repo_url_status: "valid",
                ...(v2.org ? { org_url_status: v2.org } : {}),
              }).eq("id", t.id);
              found++; written++;
              return;
            }
          }
          fetchFail++;
          // Terminal: the report body cannot be read, so there is nothing to
          // extract on any later run either.
          await admin.from("audit_history").update({ repo_url_status: "report_unfetchable" }).eq("id", t.id);
          return;
        }
        if (!hit) {
          noEvidence++;
          // Terminal state. audited_repo_url stays NULL -- the report simply does
          // not name a repository, so there is nothing to verify and nothing to
          // assert. Recording it stops every later run re-fetching this report.
          await admin.from("audit_history").update({ repo_url_status: "no_repo_in_report" }).eq("id", t.id);
          return;
        }
        found++;
        const v = await verifyAndRepair(hit.repo, hit.hash, ghToken);
        if (v.repo !== "valid") {
          invalid++;
          // The report named a repo but GitHub does not serve it to us (private
          // or deleted). Unverifiable, so the row stays blank rather than
          // carrying an unchecked URL.
          await admin.from("audit_history").update({ repo_url_status: "repo_unverifiable" }).eq("id", t.id);
          return;
        }
        const update: any = {
          audited_repo_url: v.newRepoUrl || hit.repo,
          repo_url_status: "valid",
        };
        if (hit.hash) { update.audited_commit_hash = hit.hash; update.commit_hash_status = v.commit; }
        if (v.org) update.org_url_status = v.org;
        await admin.from("audit_history").update(update).eq("id", t.id);
        written++;
      }));
    }
    return json(200, {
      ok: true, mode: "discover", firm: body.discover_firm, scanned: targets.length,
      evidence_found: found, verified_and_written: written,
      candidate_failed_github_check: invalid, no_repo_stated_in_report: noEvidence,
      report_fetch_failed: fetchFail, has_token: !!ghToken,
    });
  }

  let q = admin.from("audit_history")
    .select("id, audited_repo_url, audited_commit_hash, repo_url_status, org_url_status")
    .not("audited_repo_url", "is", null)
    .like("audited_repo_url", "%github.com%")
    .limit(limit);
  if (body.commit_backfill) {
    // Rows whose repo already verified but whose commit hash was never checked.
    // None of the other modes reach these: they all key on repo_url_status.
    q = q.eq("repo_url_status", "valid").not("audited_commit_hash", "is", null).is("commit_hash_status", null);
  } else if (body.revalidate_org) {
    // Re-check rows we'd previously marked org_url_status='valid' under v5
    q = q.eq("repo_url_status", "invalid").eq("org_url_status", "valid");
  } else if (body.backfill_org) {
    q = q.eq("repo_url_status", "invalid").is("org_url_status", null);
  } else if (body.retry_invalid) {
    q = q.eq("repo_url_status", "invalid");
  } else {
    q = q.is("repo_url_status", null);
  }

  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let repoValid = 0, repoInvalid = 0, repoError = 0, orgValid = 0, orgInvalid = 0, rescuedByRedirect = 0;
  const PARALLEL = 4;
  for (let i = 0; i < rows.length; i += PARALLEL) {
    const chunk = rows.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map(async (r: any) => ({
      id: r.id, origUrl: r.audited_repo_url,
      ...(await verifyAndRepair(r.audited_repo_url, r.audited_commit_hash, ghToken)),
    })));
    for (const r of results) {
      if (r.repo === "valid") repoValid++;
      else if (r.repo === "invalid") repoInvalid++;
      else repoError++;
      if (r.org === "valid") orgValid++;
      else if (r.org === "invalid") orgInvalid++;
      if (r.rescuedVia === "redirect") rescuedByRedirect++;
      const update: any = { repo_url_status: r.repo };
      if (r.commit !== null) update.commit_hash_status = r.commit;
      if (r.org !== null && r.org !== undefined) update.org_url_status = r.org;
      if (r.newRepoUrl) update.audited_repo_url = r.newRepoUrl;
      await admin.from("audit_history").update(update).eq("id", r.id);
    }
  }
  return json(200, {
    ok: true, scanned: rows.length, repo_valid: repoValid, repo_invalid: repoInvalid, repo_error: repoError,
    org_valid: orgValid, org_invalid: orgInvalid, rescued_by_redirect: rescuedByRedirect, has_token: !!ghToken,
  });
});
