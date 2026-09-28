// oracle-diff — compares third-party audit aggregators against our holdings and
// files the differences as review leads.
//
// This is a VALIDATION oracle, never an ingestion source. Firm-direct scraping
// stays the source of truth; nothing here writes to audit_history. Aggregators
// disagree with publishers often enough that treating them as primary would
// import their errors.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
function authorised(req: Request): boolean {
  return CRON_KEY !== "__cron_key_unset__" && req.headers.get("x-cron-key") === CRON_KEY;
}
const UNAUTH = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

// File hosts and CDNs carry audits but are not publishers.
const GENERIC = new Set([
  "github.com","google.com","docsend.com","medium.com","githubusercontent.com","ipfs.io",
  "pinata.cloud","dropbox.com","notion.site","box.com","mirror.xyz","gitbook.io","webflow.com",
  "website-files.com","amazonaws.com","cloudfront.net","digitaloceanspaces.com","googleapis.com",
  "imgur.com","twitter.com","telegram.org","x.com",
]);

function reg(host: string): string {
  const p = host.toLowerCase().replace(/^www\./, "").split(".");
  return p.length >= 2 ? p.slice(-2).join(".") : host;
}
function hostOf(u: string): string | null {
  try { return reg(new URL(u).hostname); } catch { return null; }
}
function norm(u: string): string { return u.trim().toLowerCase().replace(/\/+$/, ""); }

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? await r.json() : [];
}

async function ourReportUrls(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const page = await rest(`audit_history?select=report_url&report_url=not.is.null&offset=${off}&limit=1000`);
    for (const r of page) { const u = norm(r.report_url || ""); if (u) out.add(u); }
    if (page.length < 1000) break;
  }
  return out;
}

async function knownFirmDomains(): Promise<{ domains: Set<string>; names: Set<string> }> {
  const domains = new Set<string>(); const names = new Set<string>();
  for (const m of await rest("audit_firm_meta?select=firm_name,homepage_url,social_github&limit=1000")) {
    for (const f of ["homepage_url", "social_github"]) {
      const h = m[f] ? hostOf(m[f]) : null; if (h) domains.add(h);
    }
    names.add((m.firm_name || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  for (const c of await rest("audit_firm_cards?select=firm_name&limit=1000")) {
    names.add((c.firm_name || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  }
  return { domains, names };
}

async function upsertFindings(rows: Array<{ oracle: string; kind: string; key: string; detail: unknown }>) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/oracle_findings?on_conflict=oracle,kind,key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch.map((b) => ({ ...b, last_seen: new Date().toISOString() }))),
    });
    if (r.ok) written += batch.length;
  }
  return written;
}


// ---------------------------------------------------------------------------
// Deferred-firm re-probe.
//
// Firms parked as DEFERRED/NO_SOURCE were parked because no $0 report index
// existed AT THE TIME. Sites change: a sitemap appears, a JS page gains a
// static index, an org publishes a reports repo. This re-probes them weekly so
// a newly viable firm surfaces instead of sitting parked forever.
//
// It NEVER builds a source. It writes a finding and stops -- a human confirms
// firm identity and report shape before any audit_sources row exists.
// The firm list comes from firm_coverage, not a hardcoded array, so firms that
// get built (or newly parked) join and leave the rotation on their own.
const PROBE_BUDGET_MS = 20000;   // leaves the DefiLlama diff its share of the 60s gateway window
const PROBE_TIMEOUT_MS = 4000;
const PROBE_CONC = 3;
// Standing SKIP list -- these are never probed and never built, by policy.
const SKIP_FIRMS = ["certik", "de.fi", "defi.io"];
// Firms explicitly queued for re-probe; they go first so the budget never
// starves them behind an alphabetical tail.
const PROBE_PRIORITY = ["trust security", "secure3", "hashlock", "quantstamp", "chainaudits", "asymptotic"];

type Probe = { kind: string; url: string; signal: number; note?: string };

async function getText(url: string, cap = 400000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": "AuditScope/1.0 (+coverage probe)", Accept: "*/*" },
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > cap ? t.slice(0, cap) : t;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// A URL that plausibly addresses one audit report rather than a marketing page.
const REPORT_URL_RE = /(\.pdf(\?|$)|\/audits?\/[^/]+|\/reports?\/[^/]+|\/certificate|\/portfolio\/[^/]+|audit[-_]report)/i;

function countReportUrls(xmlOrHtml: string, mode: "loc" | "href"): number {
  const re = mode === "loc" ? /<loc\s*>([^<]+)<\/loc\s*>/gi : /href\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlOrHtml)) !== null) {
    const u = m[1].trim();
    if (REPORT_URL_RE.test(u)) seen.add(u.toLowerCase());
  }
  return seen.size;
}

async function probeFirm(firm: { firm_key: string; firm_name: string; publication_url: string | null }, deadline: number): Promise<Probe[]> {
  const probes: Probe[] = [];
  const pub = firm.publication_url || "";
  // Only synthesize /audits, /sitemap.xml etc. against the FIRM's own origin.
  // Secure3 publishes at github.com/Secure3Audit, where origin+"/reports" is
  // github.com/reports -- GitHub's page, not the firm's. Generic hosts get the
  // publication URL probed as-is and nothing invented around it.
  let origin = "";
  try {
    const h = new URL(pub).hostname;
    if (!GENERIC.has(reg(h))) origin = new URL(pub).origin;
  } catch { /* no usable url */ }
  const left = () => Date.now() < deadline;

  // 1. GitHub org -- cheapest signal and the easiest source to build from.
  const ghOrg = /github\.com\/([^/?#]+)/i.exec(pub)?.[1]
    || (origin ? new URL(origin).hostname.replace(/^www\./, "").split(".")[0] : "");
  if (ghOrg && left()) {
    const body = await getText(`https://api.github.com/orgs/${encodeURIComponent(ghOrg)}/repos?per_page=100&sort=pushed`);
    if (body) {
      try {
        const repos = JSON.parse(body) as Array<{ name: string; pushed_at?: string; full_name?: string }>;
        // A repo NAME containing "audit" proves nothing: Secure3Audit holds 20
        // *_Audit_Contest repos of similarity analyses, no reports -- exactly the
        // blocker that parked it. So require report FILES inside a repo that is
        // still being pushed to, and probe the freshest candidates only.
        const cutoff = Date.now() - 550 * 864e5; // ~18 months
        const hits = repos
          .filter((r) => /audit|report|review|assessment/i.test(r.name || ""))
          .filter((r) => Date.parse(r.pushed_at || "1970-01-01") >= cutoff)
          .slice(0, 3);
        let reportFiles = 0; const checked: string[] = [];
        for (const r of hits) {
          if (!left()) break;
          const listing = await getText(`https://api.github.com/repos/${encodeURIComponent(ghOrg)}/${encodeURIComponent(r.name)}/contents`, 200000);
          if (!listing) continue;
          try {
            const files = JSON.parse(listing) as Array<{ name: string; type: string }>;
            const n = files.filter((f) => f.type === "file" && /\.(pdf|md)$/i.test(f.name) && !/^(readme|license|contributing|code_of_conduct)\b/i.test(f.name)).length;
            reportFiles += n; checked.push(`${r.name}:${n}`);
          } catch { /* not json */ }
        }
        const stale = repos.filter((r) => /audit|report|review|assessment/i.test(r.name || "")).length - hits.length;
        probes.push({ kind: "github_org", url: `https://github.com/${ghOrg}`, signal: reportFiles,
          note: hits.length === 0
            ? `${repos.length} repos; ${stale} report-named but all pushed >18mo ago`
            : `report files found in ${checked.join(", ")}` });
      } catch { /* not json */ }
    }
  }

  // 2. Sitemaps.
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/audits/sitemap.xml"]) {
    if (!origin || !left()) break;
    const body = await getText(origin + p);
    if (!body) continue;
    const n = countReportUrls(body, "loc");
    const nested = /<sitemap\s*>/i.test(body);
    probes.push({ kind: "sitemap", url: origin + p, signal: n,
      note: nested && n === 0 ? "sitemap index (nested, not followed)" : undefined });
    if (n > 0) break;
  }

  // 3. Feeds.
  for (const p of ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml"]) {
    if (!origin || !left()) break;
    const body = await getText(origin + p, 200000);
    if (!body || !/<(rss|feed)[\s>]/i.test(body)) continue;
    const items = (body.match(/<(item|entry)[\s>]/gi) || []).length;
    const reportish = countReportUrls(body, "loc") + countReportUrls(body, "href");
    probes.push({ kind: "feed", url: origin + p, signal: reportish >= 3 ? reportish : 0,
      note: `${items} items, ${reportish} report-shaped links` });
    break;
  }

  // 4. Static index pages -- the blockers said these were client-rendered, so
  //    the question each week is whether report links now exist in static HTML.
  const idx = [pub, origin ? origin + "/audits" : "", origin ? origin + "/reports" : ""].filter(Boolean);
  for (const u of Array.from(new Set(idx))) {
    if (!left()) break;
    const body = await getText(u);
    if (!body) continue;
    const n = countReportUrls(body, "href");
    probes.push({ kind: "static_index", url: u, signal: n });
    if (n >= 5) break;
  }
  return probes;
}

async function deferredProbe(): Promise<{ probed: string[]; skipped: string[]; changes: any[]; findings: any[] }> {
  const deadline = Date.now() + PROBE_BUDGET_MS;
  const all = await rest(
    "firm_coverage?select=firm_key,firm_name,publication_url,status" +
    "&status=in.(DEFERRED,NO_SOURCE)&limit=200",
  );
  const prevRows = await rest("oracle_findings?select=key,detail&oracle=eq.deferred_probe&kind=eq.firm_probe&limit=400");
  const prev = new Map<string, any>(prevRows.map((r: any) => [r.key, r.detail || {}]));

  // Never probe a firm on the standing SKIP list, however it is parked.
  const filtered = all.filter((f: any) => {
    const k = `${f.firm_key || ""} ${f.firm_name || ""} ${f.publication_url || ""}`.toLowerCase();
    return !SKIP_FIRMS.some((sk) => k.includes(sk));
  });

  // The budget covers ~15 firms per run, so ordering decides who gets starved.
  // Named priorities first, then anyone never probed, then oldest probe first --
  // that rotates the tail instead of re-probing the alphabetical head weekly.
  const rank = (f: any) => {
    const key = (f.firm_key || "").toLowerCase();
    if (PROBE_PRIORITY.some((p) => key.includes(p))) return 0;
    return prev.has(f.firm_key) ? 2 : 1;
  };
  const probedAt = (f: any) => Date.parse(prev.get(f.firm_key)?.probed_at || "1970-01-01");
  const firms = filtered.sort((a: any, b: any) => rank(a) - rank(b) || probedAt(a) - probedAt(b));

  const probed: string[] = []; const skipped: string[] = [];
  const changes: any[] = []; const findings: any[] = [];

  for (let i = 0; i < firms.length; i += PROBE_CONC) {
    if (Date.now() >= deadline) { for (const f of firms.slice(i)) skipped.push(f.firm_key); break; }
    const slice = firms.slice(i, i + PROBE_CONC);
    const results = await Promise.all(slice.map(async (f: any) => ({ f, probes: await probeFirm(f, deadline) })));
    for (const { f, probes } of results) {
      probed.push(f.firm_key);
      const best = probes.reduce((a, b) => (b.signal > (a?.signal ?? -1) ? b : a), null as Probe | null);
      const viable = !!best && best.signal >= (best.kind === "github_org" ? 3 : 5);
      // Fingerprint only the viability verdict and the winning method, so a page
      // gaining one link does not page a human every Monday.
      const fingerprint = viable ? `${best!.kind}:${best!.signal >= 20 ? "many" : "some"}` : "none";
      const wasViable = prev.get(f.firm_key)?.viable === true;
      const changed = !prev.has(f.firm_key) ? viable : fingerprint !== prev.get(f.firm_key)?.fingerprint;

      const detail = {
        firm_name: f.firm_name, coverage_status: f.status, publication_url: f.publication_url,
        viable, fingerprint, probed_at: new Date().toISOString(),
        best_method: viable ? best!.kind : null, best_url: viable ? best!.url : null,
        probes: probes.map((p) => ({ kind: p.kind, url: p.url, signal: p.signal, note: p.note })),
        action_required: viable ? "human review: confirm firm identity and report shape, then build a source" : null,
        note: "probe only -- no audit_sources row is created by this function",
      };
      findings.push({ oracle: "deferred_probe", kind: "firm_probe", key: f.firm_key, detail });
      if (changed) changes.push({ firm: f.firm_name, firm_key: f.firm_key, was_viable: wasViable, now_viable: viable, method: detail.best_method, url: detail.best_url, signal: best?.signal ?? 0 });
    }
  }
  return { probed, skipped, changes, findings };
}

Deno.serve(async (req) => {
  if (!authorised(req)) return UNAUTH();
  const t0 = Date.now();

  const llama = await fetch("https://api.llama.fi/protocols").then((r) => r.ok ? r.json() : []).catch(() => []);
  if (!Array.isArray(llama) || llama.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "defillama unavailable" }), { status: 502 });
  }

  // Cache the oracle's own protocol list so SQL-side jobs can apply the
  // two-source CREATE rule without an HTTP call. This caches the oracle's
  // SOURCE data only -- audit_history is still never written from here.
  let llamaCached = 0;
  for (let i = 0; i < llama.length; i += 500) {
    const rows = llama.slice(i, i + 500)
      .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
      .map((p: any) => ({
        slug: String(p.slug || p.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        name: String(p.name).trim(),
        name_norm: String(p.name).toLowerCase().replace(/[^a-z0-9]/g, ""),
        url: typeof p.url === "string" && p.url ? p.url : null,
        category: typeof p.category === "string" ? p.category : null,
        refreshed_at: new Date().toISOString(),
      }))
      .filter((r: any) => r.slug && r.name_norm);
    if (rows.length === 0) continue;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/llama_protocols?on_conflict=slug`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (r.ok) llamaCached += rows.length;
  }

  const ours = await ourReportUrls();
  const { domains, names } = await knownFirmDomains();

  const missing: string[] = [];
  const byHost = new Map<string, Set<string>>();
  for (const p of llama) {
    for (const raw of (p.audit_links || [])) {
      if (typeof raw !== "string" || !raw.startsWith("http")) continue;
      const u = norm(raw);
      if (ours.has(u)) continue;
      missing.push(u);
      const h = hostOf(raw);
      if (!h) continue;
      if (!byHost.has(h)) byHost.set(h, new Set());
      byHost.get(h)!.add(p.name || p.slug || "?");
    }
  }

  // A publisher serving several DIFFERENT protocols is a firm; one serving a
  // single protocol is usually that protocol hosting its own report.
  const candidates: Array<{ host: string; protocols: number; sample: string[] }> = [];
  for (const [h, protos] of byHost) {
    if (GENERIC.has(h) || domains.has(h)) continue;
    const base = h.split(".")[0].replace(/[^a-z0-9]/g, "");
    let known = false;
    for (const n of names) { if (n.length > 3 && (base.includes(n) || n.includes(base))) { known = true; break; } }
    if (known || protos.size < 2) continue;
    // A protocol hosting its own audits looks like a publisher: aave.com serves
    // "Aave V1..V4", pooltogether.com serves "PoolTogether V3..V5". If most of
    // the protocols it serves carry its own brand, it is self-hosting, not a firm.
    const brand = h.split(".")[0].replace(/[^a-z0-9]/g, "");
    let sameBrand = 0;
    for (const p of protos) {
      const n = (p || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (brand.length > 3 && (n.includes(brand) || brand.includes(n))) sameBrand++;
    }
    if (sameBrand / protos.size >= 0.5) continue;
    candidates.push({ host: h, protocols: protos.size, sample: Array.from(protos).slice(0, 5) });
  }
  candidates.sort((a, b) => b.protocols - a.protocols);

  const findings = [
    ...candidates.map((c) => ({
      oracle: "defillama", kind: "candidate_firm", key: c.host,
      detail: { protocols: c.protocols, sample: c.sample },
    })),
  ];
  // Weekly deferred-firm re-probe rides this same Monday run: no new edge
  // function, no extra cron entry. ?skip_probe=1 runs the diff alone.
  const skipProbe = new URL(req.url).searchParams.get("skip_probe") === "1";
  const probe = skipProbe
    ? { probed: [] as string[], skipped: [] as string[], changes: [] as any[], findings: [] as any[] }
    : await deferredProbe();

  const written = await upsertFindings([...findings, ...probe.findings]);

  return new Response(JSON.stringify({
    ok: true,
    protocols_scanned: llama.length,
    llama_protocols_cached: llamaCached,
    our_report_urls: ours.size,
    audit_links_missing: missing.length,
    candidate_firms: candidates.length,
    findings_written: written,
    top_candidates: candidates.slice(0, 10),
    deferred_probe: {
      probed: probe.probed.length,
      skipped_out_of_budget: probe.skipped,
      changes: probe.changes,          // changes only -- a steady state reports nothing
      newly_viable: probe.changes.filter((c: any) => c.now_viable).length,
    },
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
