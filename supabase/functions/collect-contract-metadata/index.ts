import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

const UNIBLOCK_RPC = "https://api.uniblock.dev/uni/v1/json-rpc";
const CHAIN_ID: Record<string, number> = {
  ethereum: 1, optimism: 10, bsc: 56, polygon: 137, base: 8453, arbitrum: 42161,
  avalanche: 43114, avax: 43114, fantom: 250, gnosis: 100, linea: 59144, scroll: 534352,
  zksync: 324, blast: 81457, mantle: 5000, celo: 42220, hyperliquid: 999, berachain: 80094, sonic: 146, sei: 1329,
};

// EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// EIP-1967 admin slot
const EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
// EIP-1967 beacon slot
const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
// EIP-1822 (UUPS) PROXIABLE_UUID slot
const EIP1822_SLOT = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";

async function rpc(chain: string, method: string, params: any[]): Promise<any> {
  const chainId = CHAIN_ID[chain];
  if (!chainId) throw new Error(`Unsupported chain: ${chain}`);
  const r = await fetch(`${UNIBLOCK_RPC}?chainId=${chainId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`Uniblock ${chain}.${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error).slice(0, 150)}`);
  return j.result;
}

function slotToAddress(slot: string): string | null {
  if (!slot || slot === "0x" || /^0x0+$/.test(slot)) return null;
  // Last 40 hex chars = address
  const addr = "0x" + slot.slice(-40).toLowerCase();
  if (/^0x0+$/.test(addr)) return null;
  return addr;
}

async function inspectContract(chain: string, addr: string): Promise<{
  is_contract: boolean;
  bytecode_size: number;
  proxy_pattern: string | null;
  implementation_address: string | null;
  admin_address: string | null;
  owner_address: string | null;
  error?: string;
}> {
  // 1. Get bytecode
  let code: string;
  try {
    code = await rpc(chain, "eth_getCode", [addr, "latest"]);
  } catch (e) {
    return { is_contract: false, bytecode_size: 0, proxy_pattern: null, implementation_address: null, admin_address: null, owner_address: null, error: String(e).slice(0, 120) };
  }
  if (!code || code === "0x") {
    return { is_contract: false, bytecode_size: 0, proxy_pattern: null, implementation_address: null, admin_address: null, owner_address: null };
  }
  const bytecodeSize = Math.floor((code.length - 2) / 2);

  // 2. Check EIP-1967 implementation slot
  let implSlot: string | null = null;
  try {
    implSlot = await rpc(chain, "eth_getStorageAt", [addr, EIP1967_IMPL_SLOT, "latest"]);
  } catch { /* skip */ }
  const implAddr = slotToAddress(implSlot || "0x");

  // 3. Check admin slot
  let adminSlot: string | null = null;
  try {
    adminSlot = await rpc(chain, "eth_getStorageAt", [addr, EIP1967_ADMIN_SLOT, "latest"]);
  } catch { /* skip */ }
  const adminAddr = slotToAddress(adminSlot || "0x");

  // 4. Check beacon slot
  let beaconSlot: string | null = null;
  try {
    beaconSlot = await rpc(chain, "eth_getStorageAt", [addr, EIP1967_BEACON_SLOT, "latest"]);
  } catch { /* skip */ }
  const beaconAddr = slotToAddress(beaconSlot || "0x");

  let proxyPattern: string | null = null;
  if (implAddr) {
    proxyPattern = adminAddr ? "eip1967_transparent" : "eip1967_uups";
  } else if (beaconAddr) {
    proxyPattern = "beacon";
  } else if (bytecodeSize > 0 && bytecodeSize < 200) {
    // Tiny bytecode often = minimal proxy (EIP-1167)
    if (code.includes("363d3d373d3d3d363d73")) proxyPattern = "eip1167_minimal";
  } else {
    proxyPattern = "non_proxy";
  }

  // 5. Try owner() — function selector 0x8da5cb5b
  let ownerAddr: string | null = null;
  try {
    const ownerCall = await rpc(chain, "eth_call", [{ to: addr, data: "0x8da5cb5b" }, "latest"]);
    ownerAddr = slotToAddress(ownerCall);
  } catch { /* not OZ-Ownable, ignore */ }

  return {
    is_contract: true,
    bytecode_size: bytecodeSize,
    proxy_pattern: proxyPattern,
    implementation_address: implAddr,
    admin_address: adminAddr || beaconAddr,
    owner_address: ownerAddr,
  };
}

Deno.serve(async (req) => {
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
  const body = (await req.json().catch(() => ({}))) as { limit?: number; chain?: string };
  const limit = Math.min(Math.max(body.limit ?? 15, 1), 100);

  let q = admin.from("chain_addresses")
    .select("id, company_slug, chain, address")
    .is("metadata_checked_at", null)
    .eq("enabled", true)
    .limit(limit);
  if (body.chain) q = q.eq("chain", body.chain);
  // Skip non-EVM for now (Solana addresses need different methods)
  q = q.in("chain", Object.keys(CHAIN_ID));

  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let processed = 0, proxies = 0, immutable = 0, eoas = 0, errors = 0;
  const proxyTypes: Record<string, number> = {};
  for (const row of rows) {
    const result = await inspectContract(row.chain, row.address);
    if (result.error) errors++;
    if (result.is_contract && result.proxy_pattern && result.proxy_pattern !== "non_proxy") {
      proxies++;
      proxyTypes[result.proxy_pattern] = (proxyTypes[result.proxy_pattern] || 0) + 1;
    } else if (result.is_contract) {
      immutable++;
    } else {
      eoas++;
    }
    await admin.from("chain_addresses").update({
      is_contract: result.is_contract,
      bytecode_size: result.bytecode_size,
      proxy_pattern: result.proxy_pattern,
      implementation_address: result.implementation_address,
      admin_address: result.admin_address,
      owner_address: result.owner_address,
      metadata_checked_at: new Date().toISOString(),
      metadata_error: result.error || null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    processed++;
  }

  return json(200, {
    ok: true, scanned: rows.length,
    processed, proxies, immutable, eoas, errors,
    proxy_breakdown: proxyTypes,
  });
});
