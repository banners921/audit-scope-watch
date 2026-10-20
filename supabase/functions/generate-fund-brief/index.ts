import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Risk scores stopped updating on 2026-05-23 (compute-risk-scores has no
// schedule). While false, frozen scores are left out of everything this
// function produces. Matches RISK_SCORES_LIVE in src/lib/riskScores.ts.
const RISK_SCORES_LIVE = false;

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const STALE_DAYS = 5;

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

async function fetchFundContext(sb: any, fundSlug: string) {
  const { data: positions } = await sb.from('fund_portfolio').select('company_slug,company_name,category,round_type,amount_usd,round_date').eq('fund_slug', fundSlug);
  const slugs = Array.from(new Set((positions ?? []).map((p: any) => p.company_slug).filter(Boolean))) as string[];
  if (slugs.length === 0) return null;
  const [scores, comps, tvls, findings, briefs, hacks, unlocks, hist, fund, auditRows, economics, funding, hiring] = await Promise.all([
    RISK_SCORES_LIVE ? sb.from('protocol_risk_scores').select('company_slug,composite_score,band').in('company_slug', slugs) : Promise.resolve({ data: [] as any[] }),
    sb.from('companies').select('slug,name,category,last_audit_date,last_audit_firm,has_been_hacked,has_bug_bounty,audit_count,unique_auditor_count').in('slug', slugs),
    sb.from('protocol_metrics').select('company_slug,tvl,date').in('company_slug', slugs).not('tvl', 'is', null).order('date', { ascending: false }).limit(6000),
    sb.from('audit_history').select('company_slug,findings_critical,findings_high,findings_extraction_status,audit_date').in('company_slug', slugs).order('audit_date', { ascending: false, nullsFirst: false }),
    sb.from('risk_landscape_briefs').select('company_slug,headline,posture_rating').in('company_slug', slugs),
    sb.from('hacks').select('company_slug,name,hack_date,amount_usd,technique').in('company_slug', slugs).gte('hack_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)),
    sb.from('token_unlocks').select('company_slug,next_unlock_date,next_unlock_pct_supply,source').in('company_slug', slugs).gte('next_unlock_date', new Date().toISOString().slice(0, 10)).lte('next_unlock_date', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)),
    RISK_SCORES_LIVE ? sb.from('protocol_risk_scores_history').select('company_slug,composite_score,snapshot_date').in('company_slug', slugs).lte('snapshot_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).order('snapshot_date', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    sb.from('funds').select('name,description').eq('slug', fundSlug).maybeSingle(),
    sb.from('audit_history').select('company_slug,audit_firm').in('company_slug', slugs).not('audit_firm', 'is', null),
    sb.from('protocol_economics').select('company_slug,revenue_30d,revenue_1y,fees_30d,treasury_usd,mcap').in('company_slug', slugs),
    sb.from('funding_rounds').select('company_slug,amount_usd,round_type,date').in('company_slug', slugs).gte('date', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).order('date', { ascending: false }),
    sb.from('hiring_sources').select('company_slug,role_count,smart_contract_count').in('company_slug', slugs).order('role_count', { ascending: false, nullsFirst: false }),
  ]);
  const histMap = new Map<string, number>();
  for (const h of (hist.data ?? []) as any[]) if (!histMap.has(h.company_slug)) histMap.set(h.company_slug, h.composite_score);
  const firmCounts = new Map<string, Set<string>>();
  for (const a of (auditRows.data ?? []) as any[]) {
    const f = (a.audit_firm || '').trim();
    if (!f) continue;
    if (!firmCounts.has(f)) firmCounts.set(f, new Set());
    firmCounts.get(f)!.add(a.company_slug);
  }
  return { positions: positions ?? [], slugs, scores: scores.data ?? [], comps: comps.data ?? [], tvls: tvls.data ?? [], findings: findings.data ?? [], briefs: briefs.data ?? [], hacks: hacks.data ?? [], unlocks: unlocks.data ?? [], histMap, fund: fund.data ?? null, firmCounts, economics: economics.data ?? [], funding: funding.data ?? [], hiring: hiring.data ?? [] };
}

function computeFundPosture(ctx: any) {
  const compMap = new Map<string, any>(); for (const c of ctx.comps) compMap.set(c.slug, c);
  const scoreMap = new Map<string, any>(); for (const s of ctx.scores) scoreMap.set(s.company_slug, s);
  const tvlBySlug = new Map<string, Array<{ tvl: number; date: string }>>();
  for (const r of ctx.tvls) {
    const arr = tvlBySlug.get(r.company_slug) ?? [];
    arr.push({ tvl: Number(r.tvl), date: r.date }); tvlBySlug.set(r.company_slug, arr);
  }
  function tvlChangePct(slug: string, daysBack: number): number | null {
    const arr = tvlBySlug.get(slug); if (!arr || arr.length === 0) return null;
    const latest = arr[0]; if (!latest || !latest.tvl) return null;
    const target = Date.now() - daysBack * 86400000;
    const prev = arr.find(r => Math.abs(new Date(r.date).getTime() - target) < 7 * 86400000);
    if (!prev || prev.tvl <= 0) return null;
    return (latest.tvl - prev.tvl) / prev.tvl * 100;
  }
  let totalCriticals = 0, totalHighs = 0;
  for (const f of ctx.findings) { totalCriticals += f.findings_critical || 0; totalHighs += f.findings_high || 0; }
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recentAudits = ctx.findings.filter((f: any) => f.audit_date && f.audit_date >= since90).length;
  const bands: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let scored = 0, scoreSum = 0;
  for (const s of ctx.scores) {
    if (s.band) bands[s.band] = (bands[s.band] ?? 0) + 1;
    if (s.composite_score != null) { scoreSum += s.composite_score; scored++; }
  }
  const avgScore = scored > 0 ? Math.round(scoreSum / scored) : null;
  const movers: any[] = [];
  for (const s of ctx.scores) {
    const prev = ctx.histMap.get(s.company_slug); if (prev == null) continue;
    const delta = s.composite_score - prev;
    if (Math.abs(delta) >= 4) {
      const co = compMap.get(s.company_slug);
      movers.push({ slug: s.company_slug, name: co?.name || s.company_slug, delta, current: s.composite_score });
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const tvlGrowers: any[] = []; const tvlDecliners: any[] = [];
  for (const slug of ctx.slugs) {
    const change30 = tvlChangePct(slug, 30); if (change30 == null) continue;
    const co = compMap.get(slug); const latest = tvlBySlug.get(slug)?.[0]?.tvl ?? 0; if (latest < 1_000_000) continue;
    if (change30 >= 25) tvlGrowers.push({ slug, name: co?.name || slug, change_pct: change30, current_tvl: latest });
    if (change30 <= -25) tvlDecliners.push({ slug, name: co?.name || slug, change_pct: change30, current_tvl: latest });
  }
  tvlGrowers.sort((a, b) => b.change_pct - a.change_pct);
  tvlDecliners.sort((a, b) => a.change_pct - b.change_pct);
  const ecoMap = new Map<string, any>(); for (const e of ctx.economics) ecoMap.set(e.company_slug, e);
  const fundingMap = new Map<string, any>(); for (const f of ctx.funding) if (!fundingMap.has(f.company_slug)) fundingMap.set(f.company_slug, f);
  const hiringMap = new Map<string, any>(); for (const h of ctx.hiring) if (!hiringMap.has(h.company_slug)) hiringMap.set(h.company_slug, h);
  const recentRaises = Array.from(fundingMap.values()).slice(0, 8).map((r: any) => {
    const co = compMap.get(r.company_slug);
    return { slug: r.company_slug, name: co?.name || r.company_slug, amount_usd: r.amount_usd, round_type: r.round_type, date: r.date };
  });
  const topRevenue = Array.from(ecoMap.values()).filter((e: any) => e.revenue_30d > 0).sort((a: any, b: any) => b.revenue_30d - a.revenue_30d).slice(0, 5).map((e: any) => {
    const co = compMap.get(e.company_slug);
    return { slug: e.company_slug, name: co?.name || e.company_slug, revenue_30d: e.revenue_30d };
  });
  // Aggressive hiring (SC engineers)
  const scHires = Array.from(hiringMap.entries())
    .filter(([, v]: [string, any]) => (v.smart_contract_count || 0) >= 2)
    .map(([slug, v]: [string, any]) => { const co = compMap.get(slug); return { slug, name: co?.name || slug, sc: v.smart_contract_count }; })
    .sort((a, b) => b.sc - a.sc).slice(0, 5);
  const sectorCounts = new Map<string, number>();
  for (const slug of ctx.slugs) {
    const co = compMap.get(slug);
    sectorCounts.set(co?.category || 'Uncategorized', (sectorCounts.get(co?.category || 'Uncategorized') ?? 0) + 1);
  }
  const topSectors = Array.from(sectorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const firmConc = Array.from((ctx.firmCounts as Map<string, Set<string>>).entries())
    .map(([firm, s]) => ({ firm, clients: s.size, pct: s.size / ctx.slugs.length * 100 }))
    .sort((a, b) => b.clients - a.clients).slice(0, 5);
  const briefMap = new Map<string, any>(); for (const b of ctx.briefs) briefMap.set(b.company_slug, b);
  const findMap = new Map<string, { critical: number; high: number }>();
  for (const f of ctx.findings) {
    const e = findMap.get(f.company_slug) ?? { critical: 0, high: 0 };
    e.critical += f.findings_critical || 0; e.high += f.findings_high || 0;
    findMap.set(f.company_slug, e);
  }
  const positions: any[] = [];
  for (const slug of ctx.slugs) {
    const co = compMap.get(slug); const s = scoreMap.get(slug); const b = briefMap.get(slug); const f = findMap.get(slug);
    positions.push({
      slug, name: co?.name || slug, category: co?.category || null,
      tvl: tvlBySlug.get(slug)?.[0]?.tvl ?? null,
      tvl_change_30d: tvlChangePct(slug, 30),
      score: s?.composite_score ?? null, band: s?.band ?? null,
      brief_headline: b?.headline ?? null, brief_rating: b?.posture_rating ?? null,
      last_audit_date: co?.last_audit_date ?? null,
      has_hacked: !!co?.has_been_hacked, has_bounty: !!co?.has_bug_bounty,
      criticals_high: (f?.critical ?? 0) + (f?.high ?? 0),
    });
  }
  const worstPosture = positions.filter(p => p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  return {
    positions, totalPositions: ctx.slugs.length, avgScore, bands,
    totalCriticals, totalHighs, recentAudits,
    movers: movers.slice(0, 5), topSectors, firmConc, worstPosture,
    recentHacks: ctx.hacks, upcomingUnlocks: ctx.unlocks,
    tvlGrowers: tvlGrowers.slice(0, 5), tvlDecliners: tvlDecliners.slice(0, 5),
    recentRaises, topRevenue, scHires,
  };
}

function buildFundPrompt(fundSlug: string, fundName: string, posture: any): string {
  const positionsForPrompt = posture.positions.slice(0, 80).map((p: any) => ({
    name: p.name, category: p.category, score: p.score, band: p.band,
    tvl: p.tvl, tvl_30d_change_pct: p.tvl_change_30d,
    last_audit: p.last_audit_date, hacked: p.has_hacked, bounty: p.has_bounty,
    criticals_high: p.criticals_high, brief: p.brief_headline,
  }));
  return `You are writing a portfolio Brief for a crypto VC fund (${fundName}). This is an INFORMATION product, NOT an action tool. The analyst reads it to understand their book; they make their own decisions.

ABSOLUTE TONE RULES:
- Tone: observational analyst memo. NEVER alarmist, NEVER directive.
- Forbidden: "urgent", "immediate", "need to", "must", "action required".
- Reference positions by name when material.
- Be honest about data gaps.

Return JSON with STRUCTURED sections (not one big paragraph):
{
  "headline": string,                  // ONE sentence, max 18 words. Observational.
  "sections": {
    "aggregate": string,               // 1-2 sentences. Aggregate posture: how the book leans overall (positions count, posture distribution, no actionable framing).
    "security": string,                // 2-4 sentences. Worth knowing on the security side: which positions are notable (by name), past hacks in book, audit coverage shape. Acknowledge gaps where context is sparse.
    "growth": string,                  // 2-4 sentences. TVL movers (specific names + %s), recent raises by portfolio companies, revenue leaders, hiring momentum. Lean into momentum signals.
    "concentration": string,           // 1-3 sentences. Sector + auditor concentration. Only call out if material (single firm >15% of book, sector >30%).
    "calendar": string,                // 1-3 sentences. Forward-looking events: token unlocks coming up, governance votes, scheduled audits. Empty/short if nothing material.
    "bottom_line": string              // 1 sentence. Net trajectory of the book.
  },
  "posture_rating": "strong" | "solid" | "concerning" | "weak" | "critical",
  "data_confidence": "high" | "medium" | "low"
}

Keep each section TIGHT — the value of sections is scannability. If a section has nothing material, write 1 short sentence acknowledging that (e.g., "Sector mix is well-distributed, no concentration call-outs.").

--- EVIDENCE ---
Fund: ${fundName}
Positions: ${posture.totalPositions}${RISK_SCORES_LIVE ? ` | Avg risk score: ${posture.avgScore ?? 'n/a'}` : ''}
Risk bands: ${posture.bands.low ?? 0} low / ${posture.bands.medium ?? 0} medium / ${posture.bands.high ?? 0} high / ${posture.bands.critical ?? 0} critical
Findings (historical aggregate): ${posture.totalCriticals} critical, ${posture.totalHighs} high
Audits completed in last 90 days: ${posture.recentAudits}

Risk movers 7d (positive = posture worsened): ${posture.movers.map((m: any) => `${m.name} ${m.delta > 0 ? '+' : ''}${m.delta}→${m.current}`).join('; ') || 'none'}
Worst-current-score: ${posture.worstPosture.map((p: any) => `${p.name} ${p.score}(${p.band})${p.brief_headline ? ' — ' + p.brief_headline : ''}`).join('; ') || 'none scored'}

GROWTH:
  TVL up 25%+: ${posture.tvlGrowers.map((g: any) => `${g.name} +${g.change_pct.toFixed(0)}% to ${compactUsd(g.current_tvl)}`).join('; ') || 'none'}
  TVL down 25%+: ${posture.tvlDecliners.map((g: any) => `${g.name} ${g.change_pct.toFixed(0)}% to ${compactUsd(g.current_tvl)}`).join('; ') || 'none'}
  Recent raises 90d: ${posture.recentRaises.map((r: any) => `${r.name} ${r.round_type || ''} ${compactUsd(Number(r.amount_usd))}`).join('; ') || 'none'}
  Top revenue 30d: ${posture.topRevenue.map((e: any) => `${e.name} ${compactUsd(e.revenue_30d)}`).join('; ') || 'none'}
  Aggressive SC hiring: ${posture.scHires.map((h: any) => `${h.name} ${h.sc} SC eng`).join('; ') || 'none'}

Sector mix: ${posture.topSectors.map(([s, n]: [string, number]) => `${s} ${n}`).join('; ')}
Auditor concentration: ${posture.firmConc.map((f: any) => `${f.firm}: ${f.clients} (${f.pct.toFixed(0)}%)`).join('; ') || 'no data'}
Hacks in book last 14d: ${posture.recentHacks.length > 0 ? posture.recentHacks.map((h: any) => `${h.company_slug} ${h.hack_date} ${compactUsd(Number(h.amount_usd))}`).join('; ') : 'none'}
Forward calendar (unlocks next 30d): ${posture.upcomingUnlocks.length > 0 ? posture.upcomingUnlocks.map((u: any) => `${u.company_slug} ${u.next_unlock_date}${u.next_unlock_pct_supply ? ' (' + u.next_unlock_pct_supply + '% supply)' : ''}`).join('; ') : 'none'}

Positions (top 80): ${JSON.stringify(positionsForPrompt).slice(0, 11000)}

Return ONLY valid JSON.`;
}

async function callClaude(prompt: string): Promise<any> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, temperature: 0.15, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content?.[0]?.text || '').trim();
  let jsonStr = text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1];
  return JSON.parse(jsonStr);
}

Deno.serve(async (req) => {
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const fundSlug = body.fund_slug as string | undefined;
  const force = body.force === true;
  if (!fundSlug) return new Response(JSON.stringify({ error: 'fund_slug required' }), { status: 400 });
  if (!force) {
    const { data: existing } = await sb.from('fund_briefs').select('*').eq('fund_slug', fundSlug).maybeSingle();
    if (existing && existing.generated_at) {
      const ageDays = (Date.now() - new Date(existing.generated_at).getTime()) / 86400000;
      if (ageDays < STALE_DAYS) return new Response(JSON.stringify({ ok: true, cached: true, ...existing }), { headers: { 'Content-Type': 'application/json' } });
    }
  }
  try {
    const ctx = await fetchFundContext(sb, fundSlug);
    if (!ctx) return new Response(JSON.stringify({ ok: false, error: 'No portfolio for this fund' }), { status: 404 });
    const posture = computeFundPosture(ctx);
    const fundName = ctx.fund?.name || fundSlug;
    const prompt = buildFundPrompt(fundSlug, fundName, posture);
    const parsed = await callClaude(prompt);
    const sections = parsed.sections || {};
    // Synthesize a backward-compat `brief` string from sections for any older clients
    const compatBrief = [sections.aggregate, sections.security, sections.growth, sections.concentration, sections.calendar, sections.bottom_line].filter(Boolean).join(' ');
    if (!compatBrief || compatBrief.length < 80) throw new Error('Empty sections from Claude');
    const now = new Date();
    const stale = new Date(now.getTime() + STALE_DAYS * 86400000);
    await sb.from('fund_briefs').upsert({
      fund_slug: fundSlug,
      headline: String(parsed.headline || '').trim(),
      brief: compatBrief,
      sections,
      posture_rating: String(parsed.posture_rating || 'solid').toLowerCase(),
      data_confidence: String(parsed.data_confidence || 'medium').toLowerCase(),
      recommended_actions: [],
      data_summary: {
        positions: posture.totalPositions, avg_score: posture.avgScore, bands: posture.bands,
        movers: posture.movers, worst_posture: posture.worstPosture,
        firm_conc: posture.firmConc, sector_conc: posture.topSectors,
        recent_hacks: posture.recentHacks.length, upcoming_unlocks: posture.upcomingUnlocks.length,
        tvl_growers: posture.tvlGrowers, tvl_decliners: posture.tvlDecliners,
        recent_raises: posture.recentRaises.length, top_revenue: posture.topRevenue,
        recent_audits: posture.recentAudits, sc_hires: posture.scHires,
      },
      model: CLAUDE_MODEL,
      generated_at: now.toISOString(),
      stale_after: stale.toISOString(),
    }, { onConflict: 'fund_slug' });
    return new Response(JSON.stringify({ ok: true, cached: false, fund_slug: fundSlug, headline: parsed.headline, sections, posture_rating: parsed.posture_rating, data_confidence: parsed.data_confidence, generated_at: now.toISOString() }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }), { status: 500 });
  }
});
