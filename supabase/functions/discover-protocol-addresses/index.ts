// v2 — expanded path coverage (asset-parameters, oracles, deployments)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0";
function json(s: number, b: unknown): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url.startsWith("http") ? url : "https://" + url); return u.hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}

async function tryFetch(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/plain,text/markdown,text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const text = await r.text();
    return text.length > 100 ? text.slice(0, 500000) : null;
  } catch { return null; }
}

type Found = { chain: string; address: string; label: string | null; kind: string; source: string };

function extractAddresses(content: string, defaultChain: string, source: string): Found[] {
  const out: Found[] = [];
  const seen = new Set<string>();

  // 1) <LinkedAddress address="X" /> with table-row label
  const linkedRe = /\|\s*([^|<]{1,120}?)\s*\|[^|]*?<(?:LinkedAddress|Address)[^>]*?address="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = linkedRe.exec(content)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, "").trim().slice(0, 100);
    const addr = m[2].trim();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    const chain = /^0x[a-fA-F0-9]{40}$/.test(addr) ? "ethereum" : defaultChain;
    out.push({ chain, address: addr, label, kind: "program", source });
  }
  // 2) Plain <LinkedAddress address="X">
  const plainRe = /<(?:LinkedAddress|Address)[^>]*?address="([^"]+)"/gi;
  while ((m = plainRe.exec(content)) !== null) {
    const addr = m[1].trim();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    const chain = /^0x[a-fA-F0-9]{40}$/.test(addr) ? "ethereum" : defaultChain;
    out.push({ chain, address: addr, label: null, kind: "contract", source });
  }
  // 3) Markdown table rows with labels
  const tableRowRe = /\|\s*([^|\n]{2,120}?)\s*\|\s*[^|]*?(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{40,44})/g;
  while ((m = tableRowRe.exec(content)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, "").trim().slice(0, 100);
    const addr = m[2].trim();
    if (!addr || seen.has(addr)) continue;
    if (/^(address|program|contract|chain|notes?|deployment|version)$/i.test(label)) continue;
    seen.add(addr);
    const chain = /^0x[a-fA-F0-9]{40}$/.test(addr) ? "ethereum" : defaultChain;
    out.push({ chain, address: addr, label, kind: "contract", source });
  }
  return out;
}

async function fetchDefiLlama(slug: string): Promise<Found[]> {
  try {
    const r = await fetch(`https://api.llama.fi/protocol/${slug}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const j = await r.json();
    const out: Found[] = [];
    const chains: string[] = Array.isArray(j.chains) ? j.chains : (j.chain ? [j.chain] : []);
    if (j.address && typeof j.address === "string") {
      const primaryChain = (chains[0] || j.chain || "ethereum").toLowerCase();
      out.push({ chain: primaryChain, address: j.address, label: j.name || null, kind: "token", source: "defillama" });
    }
    return out;
  } catch { return []; }
}

async function processCompany(admin: any, company: any): Promise<any> {
  const domain = extractDomain(company.url);
  if (!domain) return { found: 0, no_url: true };
  const defaultChain = (company.category || "").toLowerCase().includes("solana") ? "solana" : "ethereum";
  const allFound: Found[] = [];

  // DefiLlama address
  for (const slug of [company.slug, company.slug.replace(/-/g, ""), company.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-")].filter(Boolean)) {
    const dl = await fetchDefiLlama(slug);
    if (dl.length > 0) { allFound.push(...dl); break; }
  }

  // Mintlify/docs markdown probes — expanded for protocols like Loopscale
  const paths = [
    `https://docs.${domain}/resources/addresses.md`,
    `https://docs.${domain}/resources/asset-parameters.md`,
    `https://docs.${domain}/resources/assets-and-oracles.md`,
    `https://docs.${domain}/resources/contracts.md`,
    `https://docs.${domain}/addresses.md`,
    `https://docs.${domain}/contracts.md`,
    `https://docs.${domain}/deployments.md`,
    `https://docs.${domain}/protocol/addresses.md`,
    `https://docs.${domain}/security/addresses.md`,
    `https://docs.${domain}/llms-full.txt`,
    `https://${domain}/llms-full.txt`,
  ];
  const fetched = await Promise.all(paths.map(p => tryFetch(p)));
  for (let i = 0; i < paths.length; i++) {
    const content = fetched[i];
    if (!content) continue;
    const found = extractAddresses(content, defaultChain, paths[i]);
    allFound.push(...found);
  }

  const dedup = new Map<string, Found>();
  for (const f of allFound) {
    const key = f.chain + "::" + f.address;
    if (!dedup.has(key) || f.label) dedup.set(key, f);
  }

  let inserted = 0, dupes = 0, errors = 0;
  for (const f of dedup.values()) {
    const { data: existing } = await admin.from("chain_addresses").select("id").eq("company_slug", company.slug).eq("chain", f.chain).eq("address", f.address).maybeSingle();
    if (existing) { dupes++; continue; }
    const { error } = await admin.from("chain_addresses").insert({
      company_slug: company.slug, chain: f.chain, address: f.address,
      label: f.label, kind: f.kind, source: f.source, enabled: true, is_contract: f.kind !== "token",
    });
    if (!error) inserted++; else errors++;
  }

  return { found: dedup.size, inserted, dupes, errors, sources: Array.from(new Set(allFound.map(f => f.source))) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "missing env" });
    const cronKey = req.headers.get("x-cron-key") || "";
    if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as { limit?: number; concurrency?: number; slug?: string };
    const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);
    const concurrency = Math.min(Math.max(body.concurrency ?? 4, 1), 8);

    let query = admin.from("companies").select("slug,name,url,category").not("url", "is", null);
    if (body.slug) query = query.eq("slug", body.slug);
    else query = query.eq('is_canonical', true).order('audit_count', { ascending: false, nullsFirst: false });
    query = query.limit(limit);
    const { data: companies, error: qerr } = await query;
    if (qerr) return json(500, { error: "query failed: " + qerr.message });
    if (!companies || companies.length === 0) return json(200, { ok: true, scanned: 0 });

    let totalInserted = 0, totalDupes = 0;
    const samples: any[] = [];
    for (let i = 0; i < companies.length; i += concurrency) {
      const chunk = companies.slice(i, i + concurrency);
      const outcomes = await Promise.all(chunk.map((c: any) => processCompany(admin, c)));
      for (let j = 0; j < outcomes.length; j++) {
        const o = outcomes[j] as any;
        totalInserted += o.inserted || 0;
        totalDupes += o.dupes || 0;
        if (o.inserted && samples.length < 12) samples.push({ slug: chunk[j].slug, inserted: o.inserted, sources: o.sources?.length });
      }
    }
    return json(200, { ok: true, scanned: companies.length, inserted: totalInserted, dupes: totalDupes, samples });
  } catch (e) { return json(500, { error: "Crash: " + String(e).slice(0, 300) }); }
});
