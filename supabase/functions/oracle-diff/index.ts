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

Deno.serve(async (req) => {
  if (!authorised(req)) return UNAUTH();
  const t0 = Date.now();

  const llama = await fetch("https://api.llama.fi/protocols").then((r) => r.ok ? r.json() : []).catch(() => []);
  if (!Array.isArray(llama) || llama.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "defillama unavailable" }), { status: 502 });
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
  const written = await upsertFindings(findings);

  return new Response(JSON.stringify({
    ok: true,
    protocols_scanned: llama.length,
    our_report_urls: ours.size,
    audit_links_missing: missing.length,
    candidate_firms: candidates.length,
    findings_written: written,
    top_candidates: candidates.slice(0, 10),
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
