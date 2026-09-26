import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const CG_BASE = "https://api.coingecko.com/api/v3";
const CG_KEY = Deno.env.get("COINGECKO_API_KEY") || "";
function cgHeaders() { const h: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "AuditScope/1.0" }; if (CG_KEY) h["x-cg-demo-api-key"] = CG_KEY; return h; }

const CG_PLATFORM_MAP: Record<string, string> = {
  "ethereum": "ethereum", "binance-smart-chain": "bsc", "polygon-pos": "polygon", "arbitrum-one": "arbitrum",
  "optimistic-ethereum": "optimism", "base": "base", "avalanche": "avalanche", "fantom": "fantom",
  "xdai": "gnosis", "linea": "linea", "scroll": "scroll", "zksync": "zksync", "blast": "blast",
  "mantle": "mantle", "celo": "celo", "hyperliquid": "hyperliquid", "berachain": "berachain",
  "sonic": "sonic", "sei-v2": "sei", "solana": "solana",
};
function slugify(s) { return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function stripSuffix(slug) { return slug.replace(/-(network|protocol|finance|labs|io|fi|xyz|tech|dao|foundation|capital|app|com)$/i, ""); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let cgListCache = null;
let byName = null; // name → single best CG entry (lowest-id tiebreak)
let byStripped = null;
async function getCgList() {
  if (cgListCache) return { list: cgListCache, byName, byStripped };
  const r = await fetch(`${CG_BASE}/coins/list?include_platform=false`, { headers: cgHeaders() });
  if (!r.ok) throw new Error(`CG /coins/list ${r.status}`);
  const arr = await r.json();
  cgListCache = arr;
  byName = new Map();
  byStripped = new Map();
  // Build name-only index; ignore symbol to avoid memecoin false positives
  for (const c of arr) {
    const s = slugify(c.name);
    // Prefer the entry whose id matches the name (canonical) over derivative tokens
    const existing = byName.get(s);
    if (!existing) byName.set(s, c);
    else if (c.id === s && existing.id !== s) byName.set(s, c);
    const stripped = stripSuffix(s);
    if (stripped && stripped !== s && !byStripped.has(stripped)) byStripped.set(stripped, c);
  }
  return { list: arr, byName, byStripped };
}

async function getCoinDetail(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${CG_BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false&market_data=false`, { headers: cgHeaders() });
    if (r.ok) return await r.json();
    if (r.status === 429) { await sleep(3000 + attempt * 1500); continue; }
    return null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  let body = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const limit = Math.min(Math.max(body.limit || 20, 1), 25); // safer for CG free tier
  const onlyMissing = body.only_missing !== false;
  const cg = await getCgList();

  let companies = [];
  if (body.company_slugs && body.company_slugs.length > 0) {
    const { data } = await admin.from("companies").select("slug,name").in("slug", body.company_slugs);
    companies = data || [];
  } else if (onlyMissing) {
    const offset = body.offset || 0;
    const { data } = await admin.from("companies").select("slug,name,audit_count").order("audit_count", { ascending: false, nullsFirst: false }).range(offset, offset + 999);
    const slugs = (data || []).map((c) => c.slug);
    if (slugs.length > 0) {
      const { data: existing } = await admin.from("chain_addresses").select("company_slug").in("company_slug", slugs);
      const have = new Set((existing || []).map((r) => r.company_slug));
      companies = data.filter((c) => !have.has(c.slug)).slice(0, limit);
    }
  } else {
    const { data } = await admin.from("companies").select("slug,name").range(body.offset || 0, (body.offset || 0) + limit - 1);
    companies = data || [];
  }
  if (companies.length === 0) return json(200, { ok: true, scanned: 0, reason: "no_companies_in_batch", cg_list_size: cg.list.length });

  const summary = { scanned: 0, matched_cg: 0, addresses_inserted: 0, unmatched: 0, no_addresses_in_cg: 0, errors: 0, cg_list_size: cg.list.length };
  const matched_samples = [];
  const unmatched_samples = [];

  for (const c of companies) {
    summary.scanned++;
    // NAME-ONLY matching with strict validation
    const cands = [slugify(c.name), slugify(c.slug), stripSuffix(slugify(c.name)), stripSuffix(slugify(c.slug))];
    let match = null;
    for (const k of cands) {
      if (!k) continue;
      if (cg.byName.has(k)) { match = cg.byName.get(k); break; }
      if (cg.byStripped.has(k)) { match = cg.byStripped.get(k); break; }
    }
    // False-positive guard: name similarity. CG name must share ≥1 token with our name.
    if (match) {
      const ourTokens = new Set(slugify(c.name).split("-").filter((t) => t.length > 2));
      const theirTokens = new Set(slugify(match.name).split("-").filter((t) => t.length > 2));
      const overlap = Array.from(ourTokens).filter((t) => theirTokens.has(t)).length;
      if (ourTokens.size > 0 && overlap === 0) match = null; // reject — too different
    }
    if (!match) {
      summary.unmatched++;
      if (unmatched_samples.length < 10) unmatched_samples.push(c.name);
      continue;
    }
    summary.matched_cg++;
    // Sleep before each detail call so we stay polite to free tier
    await sleep(2200);
    const detail = await getCoinDetail(match.id);
    if (!detail) { summary.errors++; continue; }
    const platforms = detail.platforms || {};
    const chains = [];
    for (const [cgChain, addr] of Object.entries(platforms)) {
      if (!addr || typeof addr !== "string" || addr.trim() === "") continue;
      const ourChain = CG_PLATFORM_MAP[cgChain];
      if (!ourChain) continue;
      const normAddr = ourChain === "solana" ? addr.trim() : addr.toLowerCase();
      const { error } = await admin.from("chain_addresses").upsert({
        company_slug: c.slug, chain: ourChain, address: normAddr,
        kind: "token", label: `${detail.symbol?.toUpperCase() || ""} (${match.id})`.trim(),
        source: "coingecko", enabled: true,
      }, { onConflict: "company_slug,chain,address" });
      if (!error) { summary.addresses_inserted++; chains.push(ourChain); }
      else summary.errors++;
    }
    if (chains.length === 0) summary.no_addresses_in_cg++;
    if (matched_samples.length < 10 && chains.length > 0) matched_samples.push({ slug: c.slug, our_name: c.name, cg_id: match.id, cg_name: match.name, chains });

    // Backfill logo + twitter from CG if missing
    const d = detail;
    if (d.image?.large || d.links?.twitter_screen_name) {
      const { data: existing } = await admin.from("companies").select("logo,twitter").eq("slug", c.slug).maybeSingle();
      const toUpd = {};
      if (existing && !existing.logo && d.image?.large) toUpd.logo = d.image.large;
      if (existing && !existing.twitter && d.links?.twitter_screen_name) toUpd.twitter = `https://twitter.com/${d.links.twitter_screen_name}`;
      if (Object.keys(toUpd).length > 0) await admin.from("companies").update(toUpd).eq("slug", c.slug);
    }
  }
  return json(200, { ok: true, summary, matched_samples, unmatched_samples });
});
