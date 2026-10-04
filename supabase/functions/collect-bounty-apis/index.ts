// Multi-source bug-bounty collector for platforms that publish a keyless JSON
// feed, plus the Hats Firecrawl path.
//
// Replaced collect-hats-bounties, which only ever served Hats Finance and never
// produced a row. All three sources live here because the project is capped at
// 100 edge functions; this function was deployed and the old slug deleted, so
// the count is unchanged. Pick the source with
// {"source": "hackerone" | "bugcrowd" | "hats"}.
//
//   hackerone — hackerone.com/programs/search?query=type:hackerone
//               453 public programs, 100/page, no key. Exposes meta.minimum_bounty
//               but NOT a maximum, so max_bounty_usd is deliberately left null.
//   bugcrowd  — bugcrowd.com/engagements.json
//               287 public programs, 24/page, no key. rewardSummary.maxReward is
//               a clean "$N,NNN" figure and is parsed.
//   hats      — unchanged Firecrawl index scrape; blocked while credits are out.
//
// Both JSON sources are general-purpose security platforms whose programs are
// mostly not web3, so a program is imported ONLY when its handle or name
// resolves to an existing companies row. That gate is the web3 filter: it keeps
// 740 mostly-irrelevant programs from swamping the table, and means every
// imported row carries a real company_slug rather than a minted one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder can never equal a caller-supplied header, so an unset
// CRON_KEY secret denies every request instead of authorising them.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function slugify(s: string): string {
  return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Platform names are dressed up: "Acme Bug Bounty", "Acme Managed Bug Bounty", "Acme VDP". */
function stripProgramBoilerplate(name: string): string {
  let s = String(name), prev: string;
  do {
    prev = s;
    s = s.replace(/[\s\-–—|:]*\b(managed\s+bug\s+bounty|bug\s+bounty\s+program|bug\s+bounty|bug\s+bounties|bounty\s+program|bounty|vdp|vulnerability\s+disclosure(\s+program)?|responsible\s+disclosure|security\s+program|pen\s*test)\b[\s\-–—|:]*/gi, " ").trim();
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim() || String(name);
}

/** "$12,000" -> 12000. Anything that is not a plain dollar figure returns null. */
function parseUsd(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^\$[\d,]+$/.test(s)) return null;      // rejects "Points", ranges, "€500"
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Registrable domain of a URL: "https://coinmate.io/en" -> "coinmate.io".
 * Deliberately simple — these are compared, never displayed.
 */
function registrableDomain(u: unknown): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  const m = s.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  if (!m || !m.includes(".")) return null;
  const parts = m.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join(".");
}

async function loadCompanies(admin: any) {
  const slugs = new Set<string>();
  const byName = new Map<string, string>();
  const domainBySlug = new Map<string, string>();
  for (let off = 0; off < 60000; off += 1000) {
    const { data, error } = await admin.from("companies").select("slug,name,url").range(off, off + 999);
    if (error || !data || data.length === 0) break;
    for (const c of data as Array<{ slug: string; name: string | null; url: string | null }>) {
      if (c.slug) slugs.add(c.slug);
      if (c.name) byName.set(c.name.toLowerCase().trim(), c.slug);
      const d = registrableDomain(c.url);
      if (c.slug && d) domainBySlug.set(c.slug, d);
    }
    if (data.length < 1000) break;
  }
  return { slugs, byName, domainBySlug };
}

/**
 * The web3 gate. Exact matches only — a handle that IS a company slug, or a
 * name (raw or with program boilerplate stripped) that exactly equals a company
 * name. No fuzzy or partial matching: "Coinbase" must not catch "Coinbase Wallet
 * Clone", and a miss must stay a miss rather than become a wrong attribution.
 */
function resolveCompany(handle: string, name: string, co: { slugs: Set<string>; byName: Map<string, string> }): string | null {
  const stripped = stripProgramBoilerplate(name);
  for (const cand of [slugify(handle), slugify(stripped), slugify(name)]) {
    if (cand && co.slugs.has(cand)) return cand;
  }
  for (const nm of [name, stripped]) {
    const hit = co.byName.get(String(nm).toLowerCase().trim());
    if (hit) return hit;
  }
  return null;
}

type Candidate = {
  handle: string;
  name: string;
  /** Free text from the source that should mention the program owner's own
   *  domain. Used to corroborate a name match; empty means no evidence. */
  evidence_text: string;
  program_url: string;
  max_bounty_usd: number | null;
  is_active: boolean;
  reports_valid_count: number | null;
  scope_summary: string | null;
};

async function fetchHackerOne(): Promise<{ candidates: Candidate[]; pages: number; total: number | null; skipped_no_bounty: number; errors: number }> {
  const out: Candidate[] = [];
  let pages = 0, errors = 0, total: number | null = null, skippedNoBounty = 0;
  const seen = new Set<string>();
  for (let page = 1; page <= 12; page++) {
    let results: any[] | null = null;
    try {
      const r = await fetch(
        `https://hackerone.com/programs/search?query=type%3Ahackerone&sort=published_at%3Adescending&page=${page}`,
        { headers: { Accept: "application/json", "User-Agent": "auditscope-bounty-collector" } },
      );
      if (!r.ok) { errors++; break; }
      const j = await r.json();
      if (total === null && Number.isFinite(Number(j?.total))) total = Number(j.total);
      results = Array.isArray(j?.results) ? j.results : null;
    } catch { errors++; break; }
    if (!results || results.length === 0) break;
    pages++;
    for (const p of results) {
      const handle = String(p?.handle ?? "");
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      const meta = p?.meta ?? {};
      // offers_bounties falsy marks a disclosure-only programme with no reward.
      // That is not a bug bounty and does not belong in this table.
      if (!meta.offers_bounties) { skippedNoBounty++; continue; }
      const minB = Number(meta.minimum_bounty);
      const cur = String(meta.default_currency ?? "").toUpperCase();
      const bits: string[] = [];
      if (Number.isFinite(minB) && minB > 0) bits.push(`Minimum bounty: ${minB} ${cur || "USD"}`);
      bits.push("HackerOne publishes no maximum bounty in its program index");
      out.push({
        handle,
        name: String(p?.name ?? handle),
        evidence_text: `${String(p?.about ?? "")} ${String(p?.stripped_policy ?? "")}`,
        program_url: `https://hackerone.com${String(p?.url ?? "/" + handle)}`,
        max_bounty_usd: null,   // only a minimum is published; a max would be invented
        is_active: String(meta.submission_state ?? "") === "open",
        reports_valid_count: Number.isFinite(Number(meta.resolved_report_count)) ? Number(meta.resolved_report_count) : null,
        scope_summary: bits.join(" | "),
      });
    }
    if (total !== null && seen.size >= total) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { candidates: out, pages, total, skipped_no_bounty: skippedNoBounty, errors };
}

async function fetchBugcrowd(): Promise<{ candidates: Candidate[]; pages: number; total: number | null; skipped_no_bounty: number; errors: number }> {
  const out: Candidate[] = [];
  let pages = 0, errors = 0, total: number | null = null, skippedNonBounty = 0;
  const seen = new Set<string>();
  for (let page = 1; page <= 30; page++) {
    let engagements: any[] | null = null;
    try {
      const r = await fetch(`https://bugcrowd.com/engagements.json?page=${page}`, {
        headers: { Accept: "application/json", "User-Agent": "auditscope-bounty-collector" },
      });
      if (!r.ok) { errors++; break; }
      const j = await r.json();
      const tc = Number(j?.paginationMeta?.totalCount);
      if (total === null && Number.isFinite(tc)) total = tc;
      engagements = Array.isArray(j?.engagements) ? j.engagements : null;
    } catch { errors++; break; }
    if (!engagements || engagements.length === 0) break;
    let fresh = 0;
    for (const e of engagements) {
      const brief = String(e?.briefUrl ?? "");
      const handle = brief.replace(/\/+$/, "").split("/").pop() ?? "";
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      fresh++;
      const label = String(e?.productEngagementType?.label ?? "");
      if (label && !/bug bounty/i.test(label)) { skippedNonBounty++; continue; }
      const rs = e?.rewardSummary ?? {};
      const bits: string[] = [];
      if (e?.industryName) bits.push(`Industry: ${e.industryName}`);
      if (rs.compensationSummary) bits.push(String(rs.compensationSummary));
      if (rs.maxReward && parseUsd(rs.maxReward) === null) bits.push(`Reward: ${rs.maxReward}`);
      out.push({
        handle,
        name: String(e?.name ?? handle),
        // engagements.json carries no policy text, so the brief page is fetched
        // later, and only for programs that already pass the name gate.
        evidence_text: "",
        program_url: `https://bugcrowd.com${brief}`,
        max_bounty_usd: parseUsd(rs.maxReward),
        is_active: String(e?.accessStatus ?? "") === "open",
        reports_valid_count: null,
        scope_summary: bits.length ? bits.join(" | ").slice(0, 2000) : null,
      });
    }
    // The page param is honoured, but stop as soon as a page adds nothing new
    // so a server that silently repeats page 1 cannot spin this loop.
    if (fresh === 0) break;
    pages++;
    if (total !== null && seen.size >= total) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return { candidates: out, pages, total, skipped_no_bounty: skippedNonBounty, errors };
}

/** Bugcrowd's brief page, fetched only for name-gate passers. Plain HTTP. */
async function fetchEvidence(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (auditscope)" } });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 200000);
  } catch { return ""; }
}

async function runJsonSource(
  admin: any,
  platform: string,
  fetcher: () => Promise<{ candidates: Candidate[]; pages: number; total: number | null; skipped_no_bounty: number; errors: number }>,
  opts: { dryRun: boolean; allowClosures: boolean },
) {
  const pull = await fetcher();
  if (pull.candidates.length === 0 && pull.errors > 0) {
    return json(200, { ok: false, platform, error: "source_unreachable", api_errors: pull.errors });
  }

  const co = await loadCompanies(admin);
  if (co.slugs.size === 0) {
    // Without the company list every program would fail the web3 gate and the
    // closure pass would then deactivate the platform wholesale.
    return json(200, { ok: false, platform, error: "companies_unavailable" });
  }

  const { data: existing } = await admin.from("bug_bounties")
    .select("id,program_url,protocol_slug,company_slug,is_active,manual_link_evidence")
    .eq("platform", platform);
  const rows = (existing ?? []) as Array<{ id: string; program_url: string | null; protocol_slug: string | null; company_slug: string | null; is_active: boolean | null; manual_link_evidence: unknown }>;
  const byUrl = new Map(rows.filter((r) => r.program_url).map((r) => [r.program_url!.toLowerCase(), r]));
  const slugOwner = new Map<string, string>();
  for (const r of rows) if (r.protocol_slug && r.program_url) slugOwner.set(r.protocol_slug, r.program_url.toLowerCase());

  const nowIso = new Date().toISOString();
  // Every program URL the source listed, whether or not it passed the web3
  // gate. Closure must be decided on "is it still published?", NOT on "did our
  // gate accept it this run" — otherwise a row that a human verified by hand,
  // or one the gate rejects for want of domain evidence, gets deactivated
  // despite the program being alive and listed.
  const allSourceUrls = new Set(pull.candidates.map((c) => c.program_url.toLowerCase()));
  const keptUrls = new Set<string>();
  let gated = 0, inserted = 0, updated = 0, failedGate = 0, failedDomain = 0, manualHonoured = 0;
  const samples: any[] = [];
  const gateMisses: string[] = [];
  const domainMisses: string[] = [];
  const needsEvidenceFetch = pull.candidates.some((c) => !c.evidence_text);

  for (const c of pull.candidates) {
    const companySlug = resolveCompany(c.handle, c.name, co);
    if (!companySlug) {
      failedGate++;
      if (gateMisses.length < 15) gateMisses.push(c.name);
      continue;
    }

    // A name match alone is not enough, and this is not hypothetical: these
    // platforms are general-purpose, so HackerOne's "Dyson" is the appliance
    // manufacturer while our dyson is a DEX on pelith.com, and HackerOne's
    // "Circle" is the USDC issuer while our circle is hypercircle.app. Both
    // would have been wrong attributions. So the company's own registrable
    // domain must also appear in the program's text. No domain on file, or no
    // mention of it, means the match stays unproven and is dropped.
    const domain = co.domainBySlug.get(companySlug) ?? null;
    let evidence = c.evidence_text;
    if (!evidence && needsEvidenceFetch) {
      evidence = await fetchEvidence(c.program_url);
      await new Promise((r) => setTimeout(r, 250));
    }
    // A row already carrying human-verified evidence stands in for the domain
    // check. Platforms like Bugcrowd publish no scope text at all, so the
    // automatic check can never pass there however obvious the match; without
    // this, a hand-verified program would be skipped on every run and never
    // refresh its reward figure or status.
    const priorRow = byUrl.get(c.program_url.toLowerCase());
    const manuallyVerified = Boolean(priorRow?.manual_link_evidence) && priorRow?.company_slug === companySlug;

    if (!manuallyVerified) {
      if (!domain) {
        failedDomain++;
        if (domainMisses.length < 15) domainMisses.push(`${c.name} -> ${companySlug} (no url on file)`);
        continue;
      }
      if (!evidence.toLowerCase().includes(domain)) {
        failedDomain++;
        if (domainMisses.length < 15) domainMisses.push(`${c.name} -> ${companySlug} (${domain} not referenced)`);
        continue;
      }
    } else {
      manualHonoured++;
    }
    gated++;
    keptUrls.add(c.program_url.toLowerCase());

    let keySlug = slugify(c.handle) || companySlug;
    const owner = slugOwner.get(keySlug);
    if (owner && owner !== c.program_url.toLowerCase()) keySlug = `${keySlug}-${slugify(companySlug)}`;
    slugOwner.set(keySlug, c.program_url.toLowerCase());

    const patch = {
      protocol_slug: keySlug,
      company_slug: companySlug,
      platform,
      program_url: c.program_url,
      max_bounty_usd: c.max_bounty_usd,
      is_active: c.is_active,
      reports_valid_count: c.reports_valid_count,
      scope_summary: c.scope_summary,
      last_updated: nowIso,
    };

    if (samples.length < 10) samples.push({ name: c.name, company_slug: companySlug, domain, max_bounty_usd: c.max_bounty_usd, url: c.program_url });
    if (opts.dryRun) continue;

    const prior = priorRow;
    if (prior) {
      if (!(await admin.from("bug_bounties").update(patch).eq("id", prior.id)).error) updated++;
    } else {
      if (!(await admin.from("bug_bounties").upsert(patch, { onConflict: "protocol_slug,platform" }).select("id")).error) inserted++;
    }
    await admin.from("companies").update({ has_bug_bounty: true }).eq("slug", companySlug);
  }

  // Closures: both feeds enumerate every public program, so a stored row the
  // feed no longer lists has closed. Only trusted after a complete pull.
  let closed = 0;
  let closureCheck = "skipped";
  const completePull = pull.errors === 0 && pull.total !== null && pull.candidates.length + pull.skipped_no_bounty >= pull.total;
  if (opts.dryRun) closureCheck = "skipped:dry_run";
  else if (!completePull) closureCheck = "skipped:incomplete_pull";
  else if (!opts.allowClosures) closureCheck = "disabled_by_caller";
  else {
    for (const r of rows) {
      if (r.is_active === false) continue;
      if (r.program_url && allSourceUrls.has(r.program_url.toLowerCase())) continue;
      if (!(await admin.from("bug_bounties").update({ is_active: false, last_updated: nowIso }).eq("id", r.id)).error) closed++;
    }
    closureCheck = "applied";
  }

  if (!opts.dryRun) {
    await admin.from("bounty_sources").update({
      last_scraped_at: nowIso,
      last_scrape_stats: {
        source_total: pull.total, pages: pull.pages, api_errors: pull.errors,
        bounty_programs: pull.candidates.length, skipped_no_bounty: pull.skipped_no_bounty,
        passed_web3_gate: gated, failed_name_gate: failedGate, failed_domain_gate: failedDomain,
        manual_evidence_honoured: manualHonoured,
        inserted, updated, closed, closure_check: closureCheck,
      },
    }).eq("platform", platform);
  }

  return json(200, {
    ok: true, platform, dry_run: opts.dryRun,
    source_total: pull.total, pages_read: pull.pages, api_errors: pull.errors,
    bounty_programs: pull.candidates.length, skipped_no_bounty: pull.skipped_no_bounty,
    passed_web3_gate: gated, failed_name_gate: failedGate, failed_domain_gate: failedDomain,
    manual_evidence_honoured: manualHonoured,
    known: rows.length, inserted, updated, closed, closure_check: closureCheck,
    samples, gate_miss_samples: gateMisses, domain_miss_samples: domainMisses,
  });
}

// ---------------------------------------------------------------------------
// Hats Finance: the original Firecrawl index scrape, unchanged in behaviour.
// Firecrawl credits are exhausted (HTTP 402), so this reports the failure
// rather than silently finding nothing.
// ---------------------------------------------------------------------------
const HATS_INDEX = ["https://app.hats.finance/bug-bounties", "https://app.hats.finance/honeypots", "https://app.hats.finance/"];
const HATS_RE = /https?:\/\/(?:app\.|www\.)?hats\.finance\/(?:honeypots|bug-bounties|vaults|projects)\/[a-zA-Z0-9_-]+/gi;

async function runHats(admin: any, dryRun: boolean) {
  const fcKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!fcKey) return json(200, { ok: false, platform: "Hats Finance", error: "FIRECRAWL_API_KEY unset" });
  const discovered = new Set<string>();
  let lastStatus: number | null = null, lastError: string | null = null, ok = 0;
  for (const url of HATS_INDEX) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown", "links", "html"], timeout: 35000, waitFor: 5000, onlyMainContent: false }),
      });
      lastStatus = r.status;
      if (!r.ok) { lastError = (await r.text().catch(() => "")).slice(0, 180); continue; }
      const j = await r.json();
      if (!j?.data) { lastError = "no data field"; continue; }
      ok++;
      const md = String(j.data.markdown ?? "") + "\n" + String(j.data.html ?? "").slice(0, 30000);
      for (const m of md.match(HATS_RE) ?? []) discovered.add(m);
      for (const l of (j.data.links ?? []) as string[]) for (const m of String(l).match(HATS_RE) ?? []) discovered.add(m);
    } catch (e) { lastError = String(e).slice(0, 180); }
  }
  if (!dryRun) {
    await admin.from("bounty_sources").update({
      last_scraped_at: new Date().toISOString(),
      last_scrape_stats: { firecrawl_status: lastStatus, firecrawl_error: lastError, pages_ok: ok, discovered: discovered.size },
    }).eq("platform", "Hats Finance");
  }
  return json(200, {
    ok: ok > 0, platform: "Hats Finance", dry_run: dryRun,
    discovered: discovered.size, firecrawl: { last_status: lastStatus, last_error: lastError, pages_ok: ok },
    note: ok === 0 ? "Firecrawl unavailable; no discovery possible." : undefined,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json(401, { error: "Unauthorized" });

  const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const source = String(body.source ?? "hats").toLowerCase();
  const dryRun = body.dry_run === true;
  const allowClosures = body.closures !== false;

  if (source === "hackerone") return await runJsonSource(admin, "HackerOne", fetchHackerOne, { dryRun, allowClosures });
  if (source === "bugcrowd")  return await runJsonSource(admin, "Bugcrowd",  fetchBugcrowd,  { dryRun, allowClosures });
  if (source === "hats")      return await runHats(admin, dryRun);
  return json(400, { error: `Unknown source "${source}". Use hackerone, bugcrowd or hats.` });
});
