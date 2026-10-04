// collect-cantina-bounties — Cantina bug bounty programs.
//
// Sources the programs from Cantina's own public JSON API
// (https://cantina.xyz/api/v0/bounties), not from a rendered page. That API is
// keyless and free, returns every program in one request, and states the
// reward pot, currency, status, KYC requirement, finding count and the owning
// company (handle, name, website, github) as structured fields. It therefore
// replaces the previous Firecrawl-scrape + model-extraction path outright: no
// credits are spent, and no figure is inferred from prose.
//
// Guards:
//   1. x-cron-key auth — the function is deployed verify_jwt=false so pg_cron
//      can reach it, so the body must do the authorising.
//   2. company_slug is written ONLY when a companies row actually exists,
//      matched on the API's own company handle or exact company name. An
//      unmatched program keeps protocol_slug and leaves company_slug blank for
//      the enrichment drain. Never mint a company from a program name.
//   3. max_bounty_usd is set only when the reward pot is denominated in USD or
//      a USD stablecoin. Mixed baskets ("USDC + rEUL + USUAL") and non-USD
//      tokens (BOLD, GHO) leave it blank and record the raw pot in
//      scope_summary instead — an uncertain number is worse than none.
//   4. Closures are derived from the API's status field, which is
//      authoritative, and only when the API actually returned programs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder can never equal a caller-supplied header, so an unset
// CRON_KEY secret denies every request instead of authorising them.

const PLATFORM = "Cantina";
const API_URL = "https://cantina.xyz/api/v0/bounties";
// "live" is an open program. judging/escalations_ended/complete mean the
// program has stopped accepting submissions.
const LIVE_STATUSES = new Set(["live"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Program names carry marketing boilerplate: "Pendle Bounty", "Reserve Protocol Bug Bounty". */
function stripBountyBoilerplate(name: string): string {
  let s = name;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/[\s-]*\b(bug\s*bounty|bounty|program|bug\s*bounties)\b[\s-]*$/i, "").trim();
  } while (s !== prev);
  return s || name;
}

/**
 * A reward pot is only a USD figure when it is denominated in USD or a USD
 * stablecoin. Anything else (token baskets, GHO, BOLD) returns null so the
 * column stays blank rather than carrying a number we cannot stand behind.
 */
function usdPot(pot: unknown, currency: unknown): number | null {
  const n = Number(pot);
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = String(currency ?? "").trim();
  if (/^(USD|USDC|USDT|USDG|DAI)$/i.test(c)) return n;
  if (/^USD\s*\(/i.test(c)) return n; // "USD (in Mezo)" — USD-denominated, paid in token
  return null;
}

type Program = {
  id?: string; name?: string; url?: string; status?: string; kind?: string;
  currencyCode?: string; totalRewardPot?: string | number; totalFindings?: number;
  kycRequired?: boolean; submissionFee?: string;
  timeframe?: { start?: string | null; end?: string | null };
  assetGroups?: Array<{ name?: string }>;
  company?: { name?: string; handle?: string; website?: string; github?: string; twitter?: string };
};

/** Exact matches only, in descending order of authority. Null when nothing matches. */
async function resolveCompany(sb: any, p: Program, fallbackSlug: string): Promise<string | null> {
  const handle = p.company?.handle ? slugify(p.company.handle) : null;
  for (const cand of [handle, fallbackSlug]) {
    if (!cand) continue;
    const { data } = await sb.from("companies").select("slug").eq("slug", cand).limit(1);
    if (data?.length) return data[0].slug as string;
  }
  for (const nm of [p.company?.name, p.name ? stripBountyBoilerplate(p.name) : null]) {
    if (!nm) continue;
    const { data } = await sb.from("companies").select("slug,name").ilike("name", nm).limit(5);
    const hit = (data ?? []).find((c: any) => (c.name || "").toLowerCase() === nm.toLowerCase());
    if (hit) return hit.slug as string;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json(401, { error: "Unauthorized" });

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dryRun = body.dry_run === true;
  const allowClosures = body.closures !== false;

  let programs: Program[] = [];
  let apiStatus = 0;
  try {
    const r = await fetch(API_URL, { headers: { Accept: "application/json", "User-Agent": "auditscope-bounty-collector" } });
    apiStatus = r.status;
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) programs = j as Program[];
    }
  } catch (e) {
    return json(200, { ok: false, platform: PLATFORM, error: "api_unreachable", detail: String(e).slice(0, 160) });
  }
  if (programs.length === 0) {
    return json(200, { ok: false, platform: PLATFORM, error: "api_returned_no_programs", api_status: apiStatus });
  }

  const { data: existing } = await sb
    .from("bug_bounties")
    .select("id,program_url,protocol_slug,company_slug,is_active")
    .eq("platform", PLATFORM);
  const rows = (existing ?? []) as Array<{ id: string; program_url: string | null; protocol_slug: string | null; company_slug: string | null; is_active: boolean | null }>;
  const byUrl = new Map(rows.filter((r) => r.program_url).map((r) => [r.program_url!.toLowerCase(), r]));
  const bySlug = new Map(rows.filter((r) => r.protocol_slug).map((r) => [r.protocol_slug!, r]));

  const nowIso = new Date().toISOString();
  const apiUrlsLc = new Set(programs.map((p) => (p.url || "").toLowerCase()).filter(Boolean));
  // A company can run several distinct Cantina programs with different scopes
  // and very different pots (Kiln V1 / V2 / OmniVault / Web; Monad consensus
  // $1,000,000 vs Monad UI $30,000). bug_bounties is unique on
  // (protocol_slug, platform) — which import-immunefi also upserts against, so
  // the constraint stays — therefore a second program for the same company
  // needs its own slug or it would overwrite the first and leave whichever
  // wrote last standing as "the" bounty. Suffix with the program's own stable
  // Cantina UUID prefix, and only for the program that would otherwise clash.
  const slugOwner = new Map<string, string>();   // protocol_slug -> program_url (lowercased)
  for (const r of rows) if (r.protocol_slug && r.program_url) slugOwner.set(r.protocol_slug, r.program_url.toLowerCase());
  let inserted = 0, updated = 0, unresolved_company = 0, no_usd_figure = 0, skipped = 0;
  const samples: any[] = [];

  for (const p of programs) {
    const url = p.url;
    if (!url) { skipped++; continue; }
    const baseName = p.company?.handle || (p.name ? stripBountyBoilerplate(p.name) : "");
    const protocolSlug = slugify(baseName);
    if (!protocolSlug) { skipped++; continue; }

    // Claim the bare slug, or take a suffixed one if another program holds it.
    let keySlug = protocolSlug;
    const owner = slugOwner.get(keySlug);
    if (owner && owner !== url.toLowerCase()) {
      const disc = (p.id || url).replace(/[^0-9a-f]/gi, "").slice(0, 6).toLowerCase();
      keySlug = `${protocolSlug}-${disc}`;
    }
    slugOwner.set(keySlug, url.toLowerCase());

    const companySlug = await resolveCompany(sb, p, protocolSlug);
    if (!companySlug) unresolved_company++;

    const maxUsd = usdPot(p.totalRewardPot, p.currencyCode);
    if (maxUsd === null && p.totalRewardPot) no_usd_figure++;

    const scopeBits: string[] = [];
    if (p.assetGroups?.length) scopeBits.push(p.assetGroups.map((a) => a?.name).filter(Boolean).join(", "));
    if (maxUsd === null && p.totalRewardPot) scopeBits.push(`Reward pot: ${p.totalRewardPot} ${p.currencyCode ?? ""}`.trim());
    if (p.kind && p.kind !== "public_bounty") scopeBits.push(`Program kind: ${p.kind}`);

    const patch: Record<string, unknown> = {
      protocol_slug: keySlug,
      company_slug: companySlug,                     // null when no company row exists
      platform: PLATFORM,
      program_url: url,
      max_bounty_usd: maxUsd,
      is_active: LIVE_STATUSES.has(String(p.status ?? "").toLowerCase()),
      kyc_required: typeof p.kycRequired === "boolean" ? p.kycRequired : null,
      reports_valid_count: Number.isFinite(Number(p.totalFindings)) ? Number(p.totalFindings) : null,
      program_launched_at: p.timeframe?.start ? String(p.timeframe.start).slice(0, 10) : null,
      scope_summary: scopeBits.length ? scopeBits.join(" | ").slice(0, 2000) : null,
      last_updated: nowIso,
    };

    // Match on program_url first so an existing row is refreshed rather than
    // duplicated when our derived slug differs from the one already stored.
    const prior = byUrl.get(url.toLowerCase()) ?? bySlug.get(keySlug);

    if (dryRun) {
      if (samples.length < 8) samples.push({ url, protocol_slug: keySlug, company_slug: companySlug, max_bounty_usd: maxUsd, is_active: patch.is_active, existing: Boolean(prior) });
      continue;
    }

    if (prior) {
      const { error } = await sb.from("bug_bounties").update(patch).eq("id", prior.id);
      if (!error) updated++;
    } else {
      const { error } = await sb.from("bug_bounties").upsert(patch, { onConflict: "protocol_slug,platform" });
      if (!error) inserted++;
      else if (samples.length < 8) samples.push({ url, protocol_slug: keySlug, status: "db_err", err: error.message.slice(0, 90) });
    }
    if (companySlug) await sb.from("companies").update({ has_bug_bounty: true }).eq("slug", companySlug);
    if (samples.length < 8) samples.push({ url, protocol_slug: keySlug, company_slug: companySlug, max_bounty_usd: maxUsd, is_active: patch.is_active });
  }

  // Closure pass. The API lists every program, so a stored row whose URL the
  // API no longer mentions is genuinely gone. Tested directly against the
  // API's URL set rather than against rows we happened to touch this run, so
  // a row reached by a different code path can never be closed by accident.
  // Programs the API returned with a non-live status were already set
  // is_active=false above.
  let closed = 0;
  if (!dryRun && allowClosures) {
    for (const r of rows) {
      if (r.is_active === false) continue;
      if (r.program_url && apiUrlsLc.has(r.program_url.toLowerCase())) continue;
      if (!(await sb.from("bug_bounties").update({ is_active: false, last_updated: nowIso }).eq("id", r.id)).error) closed++;
    }
  }

  if (!dryRun) {
    await sb.from("bounty_sources").update({
      last_scraped_at: nowIso,
      last_scrape_stats: { api_status: apiStatus, programs: programs.length, inserted, updated, closed, unresolved_company, no_usd_figure, skipped },
    }).eq("platform", PLATFORM);
  }

  return json(200, {
    ok: true, platform: PLATFORM, source: "cantina_api_v0", dry_run: dryRun,
    api_status: apiStatus, programs: programs.length, known: rows.length,
    inserted, updated, closed, unresolved_company, no_usd_figure, skipped,
    samples,
  });
});
