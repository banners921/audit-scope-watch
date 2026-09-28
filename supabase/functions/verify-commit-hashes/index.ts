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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ghToken = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("GH_TOKEN") || null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; retry_invalid?: boolean; backfill_org?: boolean; revalidate_org?: boolean; commit_backfill?: boolean; discover_firm?: string };
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

  if (body.discover_firm) {
    const { data: targets, error: terr } = await admin.from("audit_history")
      .select("id, report_url")
      .eq("audit_firm", body.discover_firm)
      .not("report_url", "is", null)
      .or("report_url.ilike.*.md,report_url.ilike.*.pdf")
      .is("repo_url_status", null)
      .limit(limit);
    if (terr) return json(500, { error: terr.message });
    if (!targets || targets.length === 0) return json(200, { ok: true, scanned: 0, note: "no discovery candidates" });

    let found = 0, written = 0, invalid = 0, noEvidence = 0, fetchFail = 0;
    // PDF work is memory-bound, markdown is not.
    const PAR = /\.pdf($|\?)/i.test(String(targets[0]?.report_url ?? "")) ? 1 : 3;
    for (let i = 0; i < targets.length; i += PAR) {
      const chunk = targets.slice(i, i + PAR);
      await Promise.all(chunk.map(async (t: any) => {
        const src = rawify(t.report_url);
        const isPdf = /\.pdf($|\?)/i.test(src);
        let hit: Found = null;
        if (isPdf) {
          const raw = await pdfText(src);
          if (raw === null) { fetchFail++; return; }
          hit = extractFromPdf(raw);
        } else {
          let md: string;
          try {
            const r = await fetch(src, { headers: { "User-Agent": "AuditScope-Verifier/6.0" } });
            if (!r.ok) { fetchFail++; return; }
            md = await r.text();
          } catch { fetchFail++; return; }
          hit = extractFromReport(md);
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
