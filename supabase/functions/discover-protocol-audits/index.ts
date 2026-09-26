import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FIRECRAWL_KEY = Deno.env.get('FIRECRAWL_API_KEY')!;
const GROK_KEY = Deno.env.get('GROK_API_KEY') || Deno.env.get('XAI_API_KEY')!;

// Auth: this endpoint spends Firecrawl and x.ai credits and writes to
// audit_history / companies, so it must never be anonymously callable.
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
function authorised(req: Request): boolean {
  // An unset secret must not authorise everyone ("" === "" would).
  return CRON_KEY !== "" && req.headers.get("x-cron-key") === CRON_KEY;
}
const UNAUTH = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

// Candidate paths where audit refs are commonly published
const PATHS = ['/audit', '/audits', '/security', '/security-audits', '/docs/audit', '/docs/security'];
const SUBDOMAINS = ['', 'docs.'];

function normalizeHost(u: string): string | null {
  try { return new URL(u.startsWith('http') ? u : `https://${u}`).host.replace(/^www\./, ''); } catch { return null; }
}

function candidateUrls(rootUrl: string): string[] {
  const host = normalizeHost(rootUrl);
  if (!host) return [];
  const baseHosts = SUBDOMAINS.map(s => `${s}${host}`);
  const urls: string[] = [];
  for (const h of baseHosts) {
    for (const p of PATHS) urls.push(`https://${h}${p}`);
  }
  return Array.from(new Set(urls));
}

async function fcScrape(url: string): Promise<string | null> {
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown', 'links'], timeout: 20000, onlyMainContent: true }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.data) return null;
    // Combine markdown + collected links to maximize signal
    const md = (j.data.markdown || j.data.content || '').slice(0, 18000);
    const links: string[] = (j.data.links || []).slice(0, 200);
    const linkBlock = links.length > 0 ? `\n\n=== LINKS ===\n${links.join('\n')}` : '';
    return md + linkBlock;
  } catch { return null; }
}

async function grokExtract(protocolName: string, pageUrl: string, text: string): Promise<any[] | null> {
  const prompt = `You are extracting audit history from a protocol's documentation page.

Protocol: ${protocolName}
Page URL: ${pageUrl}

Text excerpt:
${text.slice(0, 12000)}

Return a JSON object: { "audits": [{ "audit_firm": string, "audit_date": "YYYY-MM-DD" or null, "report_url": string or null, "protocol_name": string or null, "smart_contract_language": "solidity"|"rust"|"move"|"cairo"|null }] }

Rules:
- Only include real, named audit firms (e.g. Halborn, Trail of Bits, CertiK, OpenZeppelin, ConsenSys Diligence, Quantstamp, ChainSecurity, Cyfrin, Spearbit, Cantina, Hacken, PeckShield, Zellic, Sigma Prime, Code4rena, Sherlock, Ackee, Dedaub, Hashlock, etc).
- Skip generic 'audited' claims without a firm name.
- audit_date: use the report date if shown. Best effort.
- report_url: only include if a direct link to the audit PDF / report is present.
- If nothing solid is on the page return { "audits": [] }.`;
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-4-fast-reasoning',
        messages: [
          { role: 'system', content: 'Return strictly valid JSON. No prose.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.audits) ? parsed.audits : [];
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (!authorised(req)) return UNAUTH();
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Number(body.limit || 5), 30);
  const onlySlug = body.company_slug as string | undefined;
  const forceUrl = body.url as string | undefined;

  // Select targets: those with a URL, prefer never-attempted or stale (>30d)
  let targets: Array<{ slug: string; name: string; url: string }> = [];
  if (onlySlug) {
    const { data } = await sb.from('companies').select('slug,name,url').eq('slug', onlySlug).maybeSingle();
    if (data?.url) targets = [{ slug: data.slug, name: data.name, url: forceUrl || data.url }];
  } else {
    const { data } = await sb.rpc('discover_audit_candidates', { p_limit: limit }).maybeSingle().then(r => r.data ? { data: [r.data] } : { data: null }).catch(() => ({ data: null }));
    if (data) targets = data as any[];
    else {
      // Fallback: companies with a URL that have NEVER been attempted, ordered by audit_count asc (priors with few audits get scanned first)
      const { data: rows } = await sb.from('companies')
        .select('slug,name,url')
        .not('url', 'is', null)
        .neq('url', '')
        .order('audit_count', { ascending: true, nullsFirst: true })
        .limit(limit * 6);
      // Exclude slugs we've attempted in last 30d
      const slugs = (rows ?? []).map((r: any) => r.slug);
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const { data: recent } = await sb.from('audit_discovery_log').select('company_slug').in('company_slug', slugs).gte('last_attempt_at', cutoff);
      const dup = new Set((recent ?? []).map((r: any) => r.company_slug));
      targets = ((rows ?? []) as any[]).filter(r => !dup.has(r.slug)).slice(0, limit).map(r => ({ slug: r.slug, name: r.name, url: r.url }));
    }
  }

  const summary: any[] = [];

  for (const t of targets) {
    const urls = forceUrl ? [forceUrl] : candidateUrls(t.url);
    let foundText: { url: string; text: string } | null = null;
    for (const u of urls) {
      const md = await fcScrape(u);
      if (md && md.length > 400 && /(audit|security)/i.test(md)) {
        foundText = { url: u, text: md };
        break;
      }
    }
    if (!foundText) {
      await sb.from('audit_discovery_log').insert({ company_slug: t.slug, attempted_url: urls.slice(0, 3).join(','), found_count: 0, inserted_count: 0, status: 'no_page' });
      summary.push({ slug: t.slug, status: 'no_page' });
      continue;
    }

    const audits = await grokExtract(t.name, foundText.url, foundText.text);
    if (!audits) {
      await sb.from('audit_discovery_log').insert({ company_slug: t.slug, attempted_url: foundText.url, found_count: 0, inserted_count: 0, status: 'grok_failed' });
      summary.push({ slug: t.slug, status: 'grok_failed' });
      continue;
    }

    // Dedup vs existing audits by (audit_firm, report_url) or (audit_firm, audit_date) heuristic
    const { data: existing } = await sb.from('audit_history')
      .select('audit_firm,audit_date,report_url')
      .eq('company_slug', t.slug);
    const existingKeys = new Set<string>();
    for (const e of (existing ?? []) as any[]) {
      if (e.report_url) existingKeys.add(`u|${e.report_url.toLowerCase()}`);
      if (e.audit_firm && e.audit_date) existingKeys.add(`fd|${e.audit_firm.toLowerCase()}|${e.audit_date}`);
    }
    const rows: any[] = [];
    for (const a of audits) {
      const firm = (a.audit_firm || '').trim();
      if (!firm) continue;
      const reportUrl = a.report_url ? String(a.report_url).trim() : null;
      const auditDate = a.audit_date ? String(a.audit_date).slice(0, 10) : null;
      const keyU = reportUrl ? `u|${reportUrl.toLowerCase()}` : null;
      const keyFD = auditDate ? `fd|${firm.toLowerCase()}|${auditDate}` : null;
      if ((keyU && existingKeys.has(keyU)) || (keyFD && existingKeys.has(keyFD))) continue;
      rows.push({
        company_slug: t.slug,
        audit_firm: firm,
        audit_date: auditDate,
        report_url: reportUrl,
        protocol_name: a.protocol_name || t.name,
        smart_contract_language: a.smart_contract_language || null,
        data_source: 'protocol_doc_discovery',
      });
    }
    let inserted = 0;
    if (rows.length > 0) {
      const { error } = await sb.from('audit_history').insert(rows);
      if (!error) inserted = rows.length;
    }
    await sb.from('audit_discovery_log').insert({
      company_slug: t.slug, attempted_url: foundText.url,
      found_count: audits.length, inserted_count: inserted, status: 'ok',
    });
    summary.push({ slug: t.slug, attempted: foundText.url, found: audits.length, inserted });
  }

  return new Response(JSON.stringify({ ok: true, targets: targets.length, summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
