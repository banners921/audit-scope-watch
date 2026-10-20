// Risk scores stopped updating on 2026-05-23 (compute-risk-scores has no
// schedule). While false, frozen scores are left out of everything this
// function produces. Matches RISK_SCORES_LIVE in src/lib/riskScores.ts.
const RISK_SCORES_LIVE = false;

// v6 — Generic table dump. Adds /action=tables, /action=table, /action=schema so
// external consumers (RJ → Veilux) can pull EVERY data table without us writing
// a custom endpoint per table. All v5 endpoints kept for back-compat.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseLimit(url: URL, def = 100, max = 1000): number {
  const v = parseInt(url.searchParams.get("limit") || String(def), 10);
  if (isNaN(v) || v <= 0) return def;
  return Math.min(v, max);
}
function parseOffset(url: URL): number {
  const v = parseInt(url.searchParams.get("offset") || "0", 10);
  return isNaN(v) || v < 0 ? 0 : v;
}

// ============================================================================
// EXPOSED TABLES: every shareable data table. user-private + auth tables EXCLUDED.
// Each entry: { table, order_by (stable cursor), description }
// ============================================================================
const EXPOSED_TABLES: Record<string, { order_by: string; description: string }> = {
  // --- Audits core ---
  audit_history:              { order_by: "created_at",  description: "Every audit we've found (firm, date, report URL, findings counts)." },
  audit_findings_detail:      { order_by: "created_at",  description: "Per-finding detail: severity, title, summary, affected addresses." },
  audit_firm_meta:            { order_by: "firm_name",   description: "Audit firm metadata: name, description, homepage, logo, socials." },
  audit_sources:              { order_by: "slug",        description: "Scraper source registry: firm slug, source type, last scrape." },
  audit_discovery_log:        { order_by: "created_at",  description: "Log of audit-discovery scraper runs." },
  audit_firm_tiers:           { order_by: "firm_name",   description: "Firm tier classification (tier 1/2/3)." },
  audit_contracts:            { order_by: "created_at",  description: "Audit↔contract join table. confidence: explicit (cited in finding) | inferred (protocol match)." },
  // --- Companies / protocols ---
  companies:                  { order_by: "slug",        description: "Every protocol/DAO/project. is_canonical separates trusted (web3leads/defillama/manual) from pending (scraped)." },
  companies_pending:          { order_by: "id",          description: "Quarantine table for newly-discovered company names awaiting verification." },
  company_people:             { order_by: "company_slug",description: "Founders / key people per company." },
  company_merge_log:          { order_by: "merged_at",   description: "Audit log of pending→canonical company merges (suffix-strip / dedup)." },
  protocols:                  { order_by: "slug",        description: "DefiLlama-style protocols index." },
  protocol_metrics:           { order_by: "snapshot_at", description: "Time-series protocol metrics: TVL, users, volume." },
  protocol_economics:         { order_by: "company_slug",description: "Token economics: supply, mcap, FDV." },
  // protocol_risk_scores / _history are left out while RISK_SCORES_LIVE is false (see top of file).
  ...(RISK_SCORES_LIVE ? {
    protocol_risk_scores:       { order_by: "company_slug",description: "Hexagonal risk scores: audits, hacks, decentralization, etc." },
    protocol_risk_scores_history:{ order_by: "created_at", description: "Time-series of risk scores." },
  } : {}),
  protocol_notes:             { order_by: "created_at",  description: "Manual notes per protocol." },
  protocol_tags:              { order_by: "company_slug",description: "Tag join: which tags apply to which protocols." },
  // --- VC / Web3leads ---
  funds:                      { order_by: "slug",        description: "Crypto VC funds." },
  funding_rounds:             { order_by: "date",        description: "Every funding round with amounts + lead/other investors." },
  fund_portfolio:             { order_by: "round_date",  description: "fund_slug ↔ company_slug join with round metadata." },
  fund_briefs:                { order_by: "created_at",  description: "AI-generated fund overview briefs." },
  // --- On-chain ---
  chain_addresses:            { order_by: "created_at",  description: "Deployed contract addresses per company per chain." },
  chain_metrics:              { order_by: "snapshot_at", description: "Per-contract on-chain metrics: tx counts, holders, etc." },
  contract_discovery_log:     { order_by: "created_at",  description: "Log of protocol-doc-scrape runs for contract discovery." },
  contract_address_blacklist: { order_by: "address",     description: "Known-bad addresses to exclude from auto-extraction (zero address, etc)." },
  contract_risk_patterns:     { order_by: "id",          description: "Library of known risky contract patterns + remediation notes." },
  oracle_providers:           { order_by: "name",        description: "Oracle provider registry (Chainlink, Pyth, etc)." },
  oracle_dependencies:        { order_by: "company_slug",description: "Which protocol depends on which oracle provider." },
  multisig_safes:             { order_by: "address",     description: "Tracked multisig contracts per protocol." },
  multisig_signer_changes:    { order_by: "detected_at", description: "Time-series of multisig signer set changes." },
  // --- Risk events ---
  bug_bounties:               { order_by: "id",          description: "Bug bounty programs per protocol with payout ranges." },
  hacks:                      { order_by: "date",        description: "All crypto hacks/exploits with date, amount, vector." },
  // --- Signals / news ---
  news_items:                 { order_by: "published_at",description: "News mentions per protocol." },
  social_items:               { order_by: "posted_at",   description: "Social media posts (X/Twitter) per protocol." },
  governance_proposals:       { order_by: "created_at",  description: "On-chain / Snapshot governance proposals." },
  snapshot_spaces:            { order_by: "slug",        description: "Snapshot.org governance spaces per protocol." },
  token_unlocks:              { order_by: "unlock_date", description: "Upcoming token unlock schedules." },
  metric_anomalies:           { order_by: "detected_at", description: "Detected anomalies in protocol metrics (TVL spikes, etc)." },
  signal_definitions:         { order_by: "slug",        description: "Catalog of signal types we track." },
  signal_refresh_log:         { order_by: "started_at",  description: "Log of signal-refresh cron runs." },
  // --- Reports / briefs ---
  risk_landscape_briefs:      { order_by: "created_at",  description: "AI-generated risk-landscape briefs." },
  // --- Talent ---
  hiring_boards:              { order_by: "slug",        description: "Hiring board sources (Greenhouse, Lever, etc)." },
  hiring_sources:             { order_by: "company_slug",description: "Per-company ATS provider lookup." },
  institutions:               { order_by: "slug",        description: "Institutional crypto orgs (chains, infra players)." },
  // --- Ingest queues (RJ might want for backfill) ---
  solodit_ingest_queue:       { order_by: "id",          description: "Solodit URLs queued for ingestion." },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Missing supabase env" });

  const url = new URL(req.url);
  const apiKey = req.headers.get("x-api-key") || url.searchParams.get("key") || "";
  if (!apiKey || !apiKey.startsWith("as_live_")) {
    return json(401, { error: "Missing or malformed X-API-Key (expected 'as_live_...' format).", docs: "https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/audit-api?action=docs&key=YOURKEY" });
  }
  const keyHash = await sha256Hex(apiKey);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: keyRow } = await admin.from("api_keys")
    .select("id,user_id,revoked_at,rate_limit_per_min,request_count")
    .eq("key_hash", keyHash).maybeSingle();
  if (!keyRow) return json(401, { error: "Invalid API key" });
  if (keyRow.revoked_at) return json(401, { error: "This API key has been revoked" });
  admin.from("api_keys").update({ last_used_at: new Date().toISOString(), request_count: (keyRow.request_count || 0) + 1 }).eq("id", keyRow.id).then(() => {});

  const action = url.searchParams.get("action") || "docs";

  // ===== v6: tables list =====
  if (action === "tables") {
    const entries = Object.entries(EXPOSED_TABLES);
    const counts = await Promise.all(entries.map(([name]) => admin.from(name).select("*", { count: "exact", head: true }).then(r => ({ name, count: r.count || 0 })).catch(() => ({ name, count: 0 }))));
    const tables = entries.map(([name, meta], i) => ({
      name,
      row_count: counts[i].count,
      order_by: meta.order_by,
      description: meta.description,
      dump_url: `${url.origin}/functions/v1/audit-api?action=table&name=${name}&offset=0&limit=1000`,
      schema_url: `${url.origin}/functions/v1/audit-api?action=schema&name=${name}`,
    }));
    return json(200, { ok: true, count: tables.length, tables });
  }

  // ===== v6: generic table dump (paginated) =====
  if (action === "table") {
    const name = url.searchParams.get("name") || "";
    if (!EXPOSED_TABLES[name]) return json(400, { error: `Table '${name}' not exposed. See ?action=tables`, exposed: Object.keys(EXPOSED_TABLES) });
    const meta = EXPOSED_TABLES[name];
    const limit = parseLimit(url, 1000, 1000);
    const offset = parseOffset(url);
    const { data, error, count } = await admin.from(name)
      .select("*", { count: "exact" })
      .order(meta.order_by, { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    const total = count ?? 0;
    const returned = (data || []).length;
    const next_offset = offset + returned < total ? offset + returned : null;
    return json(200, { ok: true, table: name, total, offset, limit, returned, next_offset, rows: data || [] });
  }

  // ===== v6: schema introspection (column names + types) =====
  if (action === "schema") {
    const name = url.searchParams.get("name") || "";
    if (!EXPOSED_TABLES[name]) return json(400, { error: `Table '${name}' not exposed. See ?action=tables` });
    const { data, error } = await admin.rpc("exec_sql", { sql: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${name}' ORDER BY ordinal_position` }).then(r => ({ data: r.data, error: r.error })).catch(() => ({ data: null, error: { message: "schema rpc unavailable" } }));
    if (error || !data) {
      // Fallback: get one row and infer types from its keys
      const { data: sample } = await admin.from(name).select("*").limit(1);
      if (!sample || sample.length === 0) return json(200, { ok: true, table: name, columns: [], note: "empty table, schema unavailable" });
      const cols = Object.keys(sample[0]).map((c) => ({ column_name: c, data_type: typeof sample[0][c], is_nullable: "unknown", column_default: null }));
      return json(200, { ok: true, table: name, columns: cols, source: "sample_inference" });
    }
    return json(200, { ok: true, table: name, columns: data });
  }

  if (action === "docs") {
    return json(200, {
      name: "AuditScope API",
      version: "v6",
      auth: "X-API-Key header OR ?key= query param. Keys begin with 'as_live_'.",
      base_url: `${url.origin}/functions/v1/audit-api`,
      rate_limit: "60 requests per minute per key.",
      bulk_pull: {
        description: "To pull EVERY row of EVERY table (Veilux-style migration), loop /action=tables → for each table loop /action=table&name=X with offset until next_offset is null.",
        sample_pull_script: "https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/audit-api?action=pull_script&key=YOURKEY",
      },
      endpoints: [
        // ----- v6 bulk -----
        { path: "?action=tables", method: "GET", description: "List EVERY exposed table + row count + dump URL. Start here." },
        { path: "?action=table&name=X&offset=0&limit=1000", method: "GET", description: "Generic paginated dump of any exposed table. Loop until next_offset is null." },
        { path: "?action=schema&name=X", method: "GET", description: "Column names + types for a table." },
        // ----- v5 curated endpoints (kept for back-compat) -----
        { path: "?action=firms", description: "List all audit firms with counts and latest audit date." },
        { path: "?action=firm&slug=<firm-slug>", description: "Firm detail + recent audits." },
        { path: "?action=firm-audits&slug=<firm-slug>&limit=&offset=", description: "Paginated audit history for a firm." },
        { path: "?action=firm-stats&slug=<firm-slug>", description: "Aggregate stats for a firm." },
        { path: "?action=company&slug=<company-slug>", description: "Company detail + audits." },
        { path: "?action=companies&limit=&offset=&q=&category=&min_audit_count=", description: "List companies." },
        { path: "?action=audits-recent&since=YYYY-MM-DD&limit=", description: "Recent audits across firms." },
        { path: "?action=audit&id=<audit-uuid>", description: "Single audit detail." },
        { path: "?action=findings&audit_id=<audit-uuid>&limit=", description: "Findings for one audit." },
        { path: "?action=findings-by-company&slug=<company-slug>&severity=", description: "Findings filtered by company." },
        { path: "?action=funds&limit=&offset=&q=", description: "List crypto VC funds." },
        { path: "?action=fund&slug=<fund-slug>", description: "Fund detail + portfolio." },
        { path: "?action=fund-portfolio&fund_slug=<fund-slug>&limit=", description: "Fund portfolio positions." },
        { path: "?action=funding-rounds&since=YYYY-MM-DD&limit=&category=", description: "Recent funding rounds." },
        { path: "?action=audited-repos&verified_only=true&limit=&offset=", description: "Audits with verified repo URLs." },
        { path: "?action=stats", description: "Platform-wide stats." },
      ],
    });
  }

  // ===== pull-script generator (Python snippet RJ can run) =====
  if (action === "pull_script") {
    const script = `#!/usr/bin/env python3
# AuditScope → Veilux full data pull.
# Loops every exposed table, paginates 1000 rows at a time, writes one CSV per table.
# Usage:  AS_API_KEY=as_live_... python3 pull_all.py /path/to/output_dir
import csv, json, os, sys, time, urllib.request

API = "${url.origin}/functions/v1/audit-api"
KEY = os.environ["AS_API_KEY"]
OUT = sys.argv[1] if len(sys.argv) > 1 else "./auditscope_dump"
os.makedirs(OUT, exist_ok=True)

def call(action, **params):
    qs = "&".join([f"{k}={v}" for k,v in params.items()])
    req = urllib.request.Request(f"{API}?action={action}&{qs}", headers={"X-API-Key": KEY})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

tables = call("tables")["tables"]
print(f"Pulling {len(tables)} tables...")
for t in tables:
    name = t["name"]; rows = []; offset = 0
    while True:
        r = call("table", name=name, offset=offset, limit=1000)
        rows.extend(r["rows"])
        if r["next_offset"] is None: break
        offset = r["next_offset"]
        time.sleep(0.1)  # play nice with rate limit
    if not rows:
        print(f"  {name:30s} 0 rows (skipped)"); continue
    keys = list(rows[0].keys())
    path = os.path.join(OUT, f"{name}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            for k, v in row.items():
                if isinstance(v, (dict, list)): row[k] = json.dumps(v, separators=(",", ":"))
            w.writerow(row)
    print(f"  {name:30s} {len(rows):,} rows → {path}")
print("Done.")
`;
    return new Response(script, { status: 200, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=pull_all.py" } });
  }

  // =============================================================================
  // v5 endpoints (kept verbatim for back-compat)
  // =============================================================================
  if (action === "firms") {
    const { data: rows } = await admin.from("audit_history").select("audit_firm,audit_date,company_slug");
    const m = new Map<string, { firm: string; audit_count: number; client_count: Set<string>; latest_audit: string | null }>();
    for (const r of (rows || []) as Array<{ audit_firm: string; audit_date: string | null; company_slug: string | null }>) {
      if (!r.audit_firm) continue;
      const e = m.get(r.audit_firm) || { firm: r.audit_firm, audit_count: 0, client_count: new Set(), latest_audit: null };
      e.audit_count++;
      if (r.company_slug) e.client_count.add(r.company_slug);
      if (r.audit_date && (!e.latest_audit || r.audit_date > e.latest_audit)) e.latest_audit = r.audit_date;
      m.set(r.audit_firm, e);
    }
    const out = Array.from(m.values()).map((e) => ({ firm: e.firm, audit_count: e.audit_count, distinct_clients: e.client_count.size, latest_audit: e.latest_audit })).sort((a, b) => (b.latest_audit || "").localeCompare(a.latest_audit || ""));
    return json(200, { ok: true, count: out.length, firms: out });
  }

  if (action === "firm" || action === "firm-audits") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json(400, { error: "slug required" });
    const { data: firmRow } = await admin.from("audit_sources").select("slug,firm_name,last_scraped_at,source_type").eq("slug", slug).maybeSingle();
    const firmName = firmRow?.firm_name || slug;
    const limit = parseLimit(url, 100, 500);
    const offset = parseOffset(url);
    const { data: audits, error } = await admin.from("audit_history")
      .select("id,company_slug,protocol_name,audit_date,audit_type,report_url,smart_contract_language,findings_critical,findings_high,findings_medium,findings_low")
      .ilike("audit_firm", firmName).order("audit_date", { ascending: false }).range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    if (action === "firm-audits") return json(200, { ok: true, firm: firmName, limit, offset, audits: audits || [] });
    return json(200, { ok: true, firm: { slug, name: firmName, ...(firmRow || {}) }, recent_audits: (audits || []).slice(0, 20), total_recent: (audits || []).length });
  }

  if (action === "company") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json(400, { error: "slug required" });
    const { data: company } = await admin.from("companies").select("slug,name,description,category,url,twitter,linkedin,logo,audit_count,last_audit_date,last_audit_firm,is_canonical,canonical_status").eq("slug", slug).maybeSingle();
    if (!company) return json(404, { error: "company not found" });
    const { data: audits } = await admin.from("audit_history")
      .select("id,audit_firm,audit_date,audit_type,report_url,smart_contract_language,findings_critical,findings_high,findings_medium,findings_low,audited_repo_url")
      .eq("company_slug", slug).order("audit_date", { ascending: false }).limit(100);
    return json(200, { ok: true, company, audit_history: audits || [], audit_count: (audits || []).length });
  }

  if (action === "audits-recent") {
    const since = url.searchParams.get("since") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const limit = parseLimit(url, 100, 500);
    const { data, error } = await admin.from("audit_history")
      .select("id,company_slug,audit_firm,protocol_name,audit_date,audit_type,report_url,smart_contract_language,findings_critical,findings_high,findings_medium,findings_low")
      .gte("audit_date", since).order("audit_date", { ascending: false }).limit(limit);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, since, count: (data || []).length, audits: data || [] });
  }

  if (action === "audit") {
    const id = url.searchParams.get("id");
    if (!id) return json(400, { error: "id required" });
    const { data, error } = await admin.from("audit_history").select("*").eq("id", id).maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: "audit not found" });
    return json(200, { ok: true, audit: data });
  }

  if (action === "companies") {
    const limit = parseLimit(url, 100, 500);
    const offset = parseOffset(url);
    const q = url.searchParams.get("q")?.trim() || "";
    const cat = url.searchParams.get("category")?.trim() || "";
    const minAudits = parseInt(url.searchParams.get("min_audit_count") || "0", 10) || 0;
    let query = admin.from("companies")
      .select("slug,name,category,subcategory,url,logo,audit_count,unique_auditor_count,last_audit_date,last_audit_firm,has_been_hacked,has_bug_bounty,total_raised_usd,is_canonical", { count: "exact" })
      .is("parent_slug", null);
    if (q) query = query.ilike("name", `%${q}%`);
    if (cat) query = query.ilike("category", cat);
    if (minAudits > 0) query = query.gte("audit_count", minAudits);
    const { data, error, count } = await query.order("audit_count", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, count: data?.length || 0, total: count, limit, offset, companies: data || [] });
  }

  if (action === "firm-stats") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json(400, { error: "slug required" });
    const { data: firmRow } = await admin.from("audit_sources").select("firm_name").eq("slug", slug).maybeSingle();
    const firmName = firmRow?.firm_name || slug;
    const { data: audits } = await admin.from("audit_history")
      .select("id,company_slug,findings_critical,findings_high,findings_medium,findings_low,findings_informational,findings_gas,audit_date,audit_type")
      .ilike("audit_firm", firmName);
    const rows = audits || [];
    const clients = new Set<string>();
    let totalC = 0, totalH = 0, totalM = 0, totalL = 0, totalI = 0, totalG = 0;
    let earliest: string | null = null, latest: string | null = null;
    const typeCounts: Record<string, number> = {};
    for (const a of rows as any[]) {
      if (a.company_slug) clients.add(a.company_slug);
      totalC += a.findings_critical || 0; totalH += a.findings_high || 0;
      totalM += a.findings_medium || 0; totalL += a.findings_low || 0;
      totalI += a.findings_informational || 0; totalG += a.findings_gas || 0;
      if (a.audit_date) { if (!earliest || a.audit_date < earliest) earliest = a.audit_date; if (!latest || a.audit_date > latest) latest = a.audit_date; }
      const t = a.audit_type || "unknown"; typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    return json(200, { ok: true, firm: firmName, audit_count: rows.length, distinct_clients: clients.size, earliest_audit: earliest, latest_audit: latest, severity_totals: { critical: totalC, high: totalH, medium: totalM, low: totalL, informational: totalI, gas: totalG }, type_breakdown: typeCounts });
  }

  if (action === "findings") {
    const auditId = url.searchParams.get("audit_id");
    if (!auditId) return json(400, { error: "audit_id required" });
    const limit = parseLimit(url, 100, 500);
    const { data, error } = await admin.from("audit_findings_detail")
      .select("id,severity,title,summary,status,affected_addresses,created_at")
      .eq("audit_id", auditId).order("severity").limit(limit);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, audit_id: auditId, count: data?.length || 0, findings: data || [] });
  }

  if (action === "findings-by-company") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json(400, { error: "slug required" });
    const severity = url.searchParams.get("severity")?.toLowerCase().trim();
    const limit = parseLimit(url, 100, 500);
    let query = admin.from("audit_findings_detail")
      .select("id,audit_id,severity,title,summary,status,affected_addresses,created_at")
      .eq("company_slug", slug);
    if (severity && ["critical","high","medium","low","informational","gas"].includes(severity)) query = query.eq("severity", severity);
    const { data, error } = await query.order("severity").limit(limit);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, company_slug: slug, severity_filter: severity || null, count: data?.length || 0, findings: data || [] });
  }

  if (action === "funds") {
    const limit = parseLimit(url, 100, 500);
    const offset = parseOffset(url);
    const q = url.searchParams.get("q")?.trim() || "";
    let query = admin.from("funds").select("slug,name,website,description,logo,investment_count", { count: "exact" });
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error, count } = await query.order("investment_count", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, count: data?.length || 0, total: count, limit, offset, funds: data || [] });
  }

  if (action === "fund") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json(400, { error: "slug required" });
    const { data: fund } = await admin.from("funds").select("*").eq("slug", slug).maybeSingle();
    if (!fund) return json(404, { error: "fund not found" });
    const { data: portfolio } = await admin.from("fund_portfolio")
      .select("company_slug,company_name,category,round_type,amount_usd,round_date")
      .eq("fund_slug", slug).order("round_date", { ascending: false, nullsFirst: false }).limit(100);
    return json(200, { ok: true, fund, portfolio: portfolio || [], portfolio_count: (portfolio || []).length });
  }

  if (action === "fund-portfolio") {
    const fundSlug = url.searchParams.get("fund_slug");
    if (!fundSlug) return json(400, { error: "fund_slug required" });
    const limit = parseLimit(url, 200, 1000);
    const { data, error } = await admin.from("fund_portfolio")
      .select("company_slug,company_name,category,round_type,amount_usd,round_date")
      .eq("fund_slug", fundSlug).order("round_date", { ascending: false, nullsFirst: false }).limit(limit);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, fund_slug: fundSlug, count: data?.length || 0, portfolio: data || [] });
  }

  if (action === "funding-rounds") {
    const since = url.searchParams.get("since") || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const limit = parseLimit(url, 100, 500);
    const cat = url.searchParams.get("category")?.trim() || "";
    let query = admin.from("funding_rounds")
      .select("id,company_slug,company_name,round_type,amount_usd,date,lead_investors,other_investors,category,announcement_url")
      .gte("date", since);
    if (cat) query = query.ilike("category", cat);
    const { data, error } = await query.order("date", { ascending: false, nullsFirst: false }).limit(limit);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, since, count: data?.length || 0, rounds: data || [] });
  }

  if (action === "audited-repos") {
    const verifiedOnly = (url.searchParams.get("verified_only") ?? "true").toLowerCase() !== "false";
    const limit = parseLimit(url, 100, 500);
    const offset = parseOffset(url);
    let query = admin.from("audit_history")
      .select("id,company_slug,protocol_name,audit_firm,audit_date,audited_repo_url,audited_commit_hash,repo_url_status,commit_hash_status,smart_contract_language,audited_chains,findings_critical,findings_high,findings_medium,findings_low", { count: "exact" })
      .not("audited_repo_url", "is", null);
    if (verifiedOnly) query = query.eq("repo_url_status", "valid");
    const { data, error, count } = await query.order("audit_date", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, verified_only: verifiedOnly, count: data?.length || 0, total: count, repos: data || [] });
  }

  if (action === "stats") {
    const [auditsTot, firmsTot, companiesTot, fundsTot, findingsTot, contractsTot, recent] = await Promise.all([
      admin.from("audit_history").select("id", { count: "exact", head: true }),
      admin.from("audit_history").select("audit_firm").then(r => new Set((r.data || []).map((x: any) => x.audit_firm).filter(Boolean)).size),
      admin.from("companies").select("slug", { count: "exact", head: true }),
      admin.from("funds").select("slug", { count: "exact", head: true }),
      admin.from("audit_findings_detail").select("id", { count: "exact", head: true }),
      admin.from("chain_addresses").select("id", { count: "exact", head: true }),
      admin.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);
    return json(200, {
      ok: true,
      stats: {
        audits: auditsTot.count || 0,
        firms: typeof firmsTot === "number" ? firmsTot : 0,
        companies: companiesTot.count || 0,
        funds: fundsTot.count || 0,
        findings: findingsTot.count || 0,
        contracts: contractsTot.count || 0,
        audits_last_7d: recent.count || 0,
      },
      as_of: new Date().toISOString(),
    });
  }

  return json(400, { error: `unknown action '${action}'. See ?action=docs` });
});
