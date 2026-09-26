import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const LLAMA = "https://api.llama.fi";
const Z = 2.5;
const MIN_MEAN_FEES = 1000;
const MIN_MEAN_VOL = 10000;
const SUPPRESS_RECENT_DAYS = 3;

async function fetchSummary(slug, dataType) {
  try {
    const url = `${LLAMA}/summary/${dataType === "dailyFees" ? "fees" : "dexs"}/${encodeURIComponent(slug)}?dataType=${dataType}`;
    const r = await fetch(url, { headers: { "User-Agent": "AuditScope/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// DefiLlama /protocol/:slug returns full historical TVL in chainTvls[chain].tvl[{date,totalLiquidityUSD}]
// AND a top-level tvl array of {date, totalLiquidityUSD} for total across chains.
async function fetchProtocolTvl(slug) {
  try {
    const r = await fetch(`${LLAMA}/protocol/${encodeURIComponent(slug)}`, { headers: { "User-Agent": "AuditScope/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const arr = Array.isArray(j?.tvl) ? j.tvl : [];
    const m = new Map();
    for (const point of arr) {
      if (typeof point?.date !== "number" || typeof point?.totalLiquidityUSD !== "number") continue;
      const d = new Date(point.date * 1000).toISOString().slice(0, 10);
      m.set(d, point.totalLiquidityUSD);
    }
    return m;
  } catch { return null; }
}

async function fetchProtocols() {
  const m = new Map();
  try {
    const r = await fetch(`${LLAMA}/protocols`, { headers: { "User-Agent": "AuditScope/1.0" } });
    if (!r.ok) return m;
    const arr = await r.json();
    if (Array.isArray(arr)) for (const p of arr) {
      if (typeof p?.slug === "string") m.set(p.slug, { chains: Array.isArray(p.chains) ? p.chains : [] });
    }
  } catch {}
  return m;
}
function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length; }
function stdev(arr, mu) { if (arr.length < 2) return 0; const v = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1); return Math.sqrt(v); }
function primaryChain(chains) { return chains.length === 0 ? "unknown" : chains[0].toLowerCase().replace(/\s+/g, "-"); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isCron = cronKey === CRON_KEY;
  if (!isCron) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  let body = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const backfillDays = Math.min(Math.max(body.backfill_days || 1, 1), 60);
  const llama = await fetchProtocols();
  let targets;
  if (body.company_slugs && body.company_slugs.length > 0) targets = body.company_slugs.slice(0, body.limit || 3000);
  else {
    const ours = new Set();
    for (let off = 0; off < 50000; off += 1000) {
      const { data } = await admin.from("companies").select("slug").range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) ours.add(r.slug);
      if (data.length < 1000) break;
    }
    const inter = [];
    for (const slug of llama.keys()) if (ours.has(slug)) inter.push(slug);
    targets = inter.slice(body.offset || 0, (body.offset || 0) + (body.limit || 3000));
  }
  if (targets.length === 0) return json(200, { ok: true, scanned: 0, llama_known: llama.size });

  const summary = { scanned: 0, with_data: 0, metric_rows: 0, tvl_rows: 0, anomalies: 0, suppressed_low_baseline: 0, suppressed_persistent: 0, errors: 0, llama_known: llama.size, candidates: targets.length, backfill_days: backfillDays, z_threshold: Z };

  const CONC = 6;
  for (let i = 0; i < targets.length; i += CONC) {
    const chunk = targets.slice(i, i + CONC);
    await Promise.all(chunk.map(async (slug) => {
      summary.scanned++;
      const [feeRes, volRes, tvlMap] = await Promise.all([
        fetchSummary(slug, "dailyFees"),
        fetchSummary(slug, "dailyVolume"),
        fetchProtocolTvl(slug),
      ]);
      const toMap = (s) => {
        const m = new Map();
        for (const [ts, v] of (s?.totalDataChart || [])) {
          if (typeof ts !== "number" || typeof v !== "number") continue;
          m.set(new Date(ts * 1000).toISOString().slice(0, 10), v);
        }
        return m;
      };
      const feesMap = toMap(feeRes); const volMap = toMap(volRes);
      const hasAny = feesMap.size > 0 || volMap.size > 0 || (tvlMap && tvlMap.size > 0);
      if (!hasAny) return;
      summary.with_data++;
      const chain = primaryChain(llama.get(slug)?.chains || []);
      const allDates = Array.from(new Set([
        ...feesMap.keys(),
        ...volMap.keys(),
        ...(tvlMap ? Array.from(tvlMap.keys()) : []),
      ])).sort();
      const last120 = allDates.slice(-120);
      // Upsert metric rows — now with TVL
      const rowsToUpsert = [];
      for (const d of last120.slice(-90)) {
        const fee = feesMap.get(d); const vol = volMap.get(d); const tvl = tvlMap?.get(d);
        if (fee == null && vol == null && tvl == null) continue;
        rowsToUpsert.push({
          company_slug: slug, defillama_slug: slug, date: d,
          fees_usd: fee == null ? null : fee,
          volume_usd: vol == null ? null : vol,
          tvl_usd: tvl == null ? null : tvl,
          source: "defillama",
        });
      }
      if (rowsToUpsert.length > 0) {
        // batch upsert in chunks of 50 to avoid huge payloads
        for (let j = 0; j < rowsToUpsert.length; j += 50) {
          const batch = rowsToUpsert.slice(j, j + 50);
          const { error } = await admin.from("protocol_metrics").upsert(batch, { onConflict: "company_slug,date,source" });
          if (!error) {
            summary.metric_rows += batch.length;
            summary.tvl_rows += batch.filter(r => r.tvl_usd != null).length;
          } else summary.errors++;
        }
      }
      // Anomaly detection — unchanged (fees + volume)
      const lastFireBySlugMetric = new Map();
      const targetDates = last120.slice(-backfillDays);
      for (const td of targetDates) {
        const idx = last120.indexOf(td);
        if (idx < 7) continue;
        const window = last120.slice(Math.max(0, idx - 30), idx);
        const priorFees = window.map((d) => feesMap.get(d)).filter((x) => typeof x === "number" && x > 0);
        const priorVol = window.map((d) => volMap.get(d)).filter((x) => typeof x === "number" && x > 0);
        const tFee = feesMap.get(td); const tVol = volMap.get(td);
        if (tFee != null && priorFees.length >= 7) {
          const mu = mean(priorFees); const sigma = stdev(priorFees, mu);
          if (mu < MIN_MEAN_FEES) summary.suppressed_low_baseline++;
          else if (sigma > 0 && Math.abs((tFee - mu) / sigma) >= Z) {
            const z = (tFee - mu) / sigma;
            const lastFire = lastFireBySlugMetric.get("fees");
            if (lastFire && (new Date(td).getTime() - lastFire.date) <= SUPPRESS_RECENT_DAYS * 86400000 && Math.sign(lastFire.z) === Math.sign(z)) summary.suppressed_persistent++;
            else {
              const dir = z > 0 ? "up" : "down";
              const factor = mu > 0 ? (tFee / mu).toFixed(1) : "?";
              const { error } = await admin.from("metric_anomalies").upsert({
                company_slug: slug, chain, metric_kind: "fees", audience: "both", date: td,
                value: tFee, mean_30d: mu, stdev_30d: sigma, z_score: z, direction: dir,
                detail: `${slug} fees ${dir === "up" ? "spike" : "drop"} on ${td}: $${Math.round(tFee).toLocaleString()} vs 30d avg $${Math.round(mu).toLocaleString()} (${factor}x, z=${z.toFixed(2)}).`,
              }, { onConflict: "company_slug,chain,metric_kind,date" });
              if (!error) { summary.anomalies++; lastFireBySlugMetric.set("fees", { date: new Date(td).getTime(), z }); } else summary.errors++;
            }
          }
        }
        if (tVol != null && priorVol.length >= 7) {
          const mu = mean(priorVol); const sigma = stdev(priorVol, mu);
          if (mu < MIN_MEAN_VOL) summary.suppressed_low_baseline++;
          else if (sigma > 0 && Math.abs((tVol - mu) / sigma) >= Z) {
            const z = (tVol - mu) / sigma;
            const lastFire = lastFireBySlugMetric.get("volume");
            if (lastFire && (new Date(td).getTime() - lastFire.date) <= SUPPRESS_RECENT_DAYS * 86400000 && Math.sign(lastFire.z) === Math.sign(z)) summary.suppressed_persistent++;
            else {
              const dir = z > 0 ? "up" : "down";
              const factor = mu > 0 ? (tVol / mu).toFixed(1) : "?";
              const { error } = await admin.from("metric_anomalies").upsert({
                company_slug: slug, chain, metric_kind: "volume", audience: "infra", date: td,
                value: tVol, mean_30d: mu, stdev_30d: sigma, z_score: z, direction: dir,
                detail: `${slug} volume ${dir === "up" ? "spike" : "drop"} on ${td}: $${Math.round(tVol).toLocaleString()} vs 30d avg $${Math.round(mu).toLocaleString()} (${factor}x, z=${z.toFixed(2)}).`,
              }, { onConflict: "company_slug,chain,metric_kind,date" });
              if (!error) { summary.anomalies++; lastFireBySlugMetric.set("volume", { date: new Date(td).getTime(), z }); } else summary.errors++;
            }
          }
        }
      }
    }));
  }
  return json(200, { ok: true, summary });
});
