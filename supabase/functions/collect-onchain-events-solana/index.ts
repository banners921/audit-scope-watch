import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

const UNIBLOCK_SOL_RPC = "https://api.uniblock.dev/uni/v1/json-rpc?chainId=solana";
const BPF_LOADER_UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111111";
const SQUADS_V4 = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"; // Squads multisig v4 program id
// Note: Realms (SPL Governance) program id is `GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw` etc — we add later.

async function solRpc<T>(apiKey: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(UNIBLOCK_SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Uniblock solana.${method} HTTP ${r.status}: ${t.slice(0, 250)}`); }
  const j = await r.json();
  if (j.error) throw new Error(`Uniblock solana.${method} error: ${JSON.stringify(j.error).slice(0, 300)}`);
  return j.result as T;
}

type Signature = { signature: string; slot: number; blockTime?: number | null; err: unknown };
type TxInstruction = { programId: string; accounts?: string[]; data?: string; parsed?: { type?: string; info?: Record<string, unknown> }; program?: string };
type TxMessage = { instructions: TxInstruction[]; accountKeys?: Array<{ pubkey: string } | string> };
type TxResp = { transaction?: { message?: TxMessage; signatures?: string[] }; meta?: { err: unknown; innerInstructions?: Array<{ instructions: TxInstruction[] }> }; slot?: number; blockTime?: number | null };

function collectAllInstructions(tx: TxResp): TxInstruction[] {
  const top = tx.transaction?.message?.instructions || [];
  const inner = (tx.meta?.innerInstructions || []).flatMap((g) => g.instructions || []);
  return [...top, ...inner];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const uniblockKey = Deno.env.get("UNIBLOCK_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  if (!uniblockKey) return json(500, { error: "UNIBLOCK_API_KEY not set" });

  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isCron = cronKey === CRON_KEY;
  if (!isCron) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  let body: { company_slugs?: string[]; limit?: number } = {};
  try { body = await req.json().catch(() => ({})); } catch { /* */ }

  // chain_addresses where chain='solana'. We treat `address` as the Solana program id.
  let q = admin.from("chain_addresses").select("id,company_slug,chain,address,kind,last_seen_block,label").eq("enabled", true).eq("chain", "solana");
  if (body.company_slugs && body.company_slugs.length > 0) q = q.in("company_slug", body.company_slugs);
  q = q.limit(body.limit ?? 100);
  const { data: addrs, error } = await q;
  if (error) return json(500, { error: "chain_addresses query failed", details: error.message });
  if (!addrs || addrs.length === 0) return json(200, { ok: true, scanned: 0, reason: "no_solana_addresses" });

  const slugs = Array.from(new Set(addrs.map((a) => a.company_slug)));
  const { data: companies } = await admin.from("companies").select("slug,name").in("slug", slugs);
  const nameBySlug = new Map((companies || []).map((c) => [c.slug, c.name]));

  const summary = { scanned_programs: 0, signatures_checked: 0, upgrades_detected: 0, multisig_changes_detected: 0, signals_inserted: 0, errors: [] as Array<{ slug?: string; address?: string; err: string }> };

  // last_seen_block stores a slot number on Solana (slot is the closest analog to block height)
  for (const a of addrs) {
    summary.scanned_programs++;
    const programId = a.address;
    let sigs: Signature[] = [];
    try {
      // Most recent 25 signatures for this program. We'll only inspect ones newer than last_seen_block (slot).
      sigs = await solRpc<Signature[]>(uniblockKey, "getSignaturesForAddress", [programId, { limit: 25 }]);
    } catch (e) { summary.errors.push({ slug: a.company_slug, address: programId, err: String(e).slice(0, 250) }); continue; }

    const lastSlot = a.last_seen_block ? Number(a.last_seen_block) : 0;
    const newSigs = sigs.filter((s) => !s.err && (s.slot || 0) > lastSlot);
    let maxSlotSeen = lastSlot;

    for (const s of newSigs) {
      summary.signatures_checked++;
      if (s.slot && s.slot > maxSlotSeen) maxSlotSeen = s.slot;
      let tx: TxResp | null = null;
      try {
        tx = await solRpc<TxResp>(uniblockKey, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
      } catch (e) { summary.errors.push({ slug: a.company_slug, err: `getTransaction(${s.signature.slice(0,8)}…): ${String(e).slice(0,180)}` }); continue; }
      if (!tx || tx.meta?.err) continue;

      const ixs = collectAllInstructions(tx);
      const companyName = nameBySlug.get(a.company_slug) || a.company_slug;
      const txUrl = `https://solscan.io/tx/${s.signature}`;

      // Program upgrade: any instruction whose programId is BPFLoaderUpgradeable
      const upgradeIx = ixs.find((ix) => ix.programId === BPF_LOADER_UPGRADEABLE);
      if (upgradeIx) {
        summary.upgrades_detected++;
        const { error: insErr } = await admin.from("account_signals").insert({
          company_slug: a.company_slug, signal_type: "onchain-upgrade", signal_subtype: "solana-program-upgrade",
          source: "onchain-solana",
          title: `${companyName}: Solana program upgraded${a.label ? ` (${a.label})` : ""}`,
          detail: `Program ${programId} upgraded via BPFLoaderUpgradeable in slot ${s.slot}. Fresh code on mainnet — audit moment.`,
          evidence_url: txUrl, fired_at: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : new Date().toISOString(),
          score_boost: 90,
          raw_data: { chain: "solana", program_id: programId, signature: s.signature, slot: s.slot, kind: a.kind },
        });
        if (!insErr) summary.signals_inserted++;
        else if (insErr.code !== "23505") summary.errors.push({ slug: a.company_slug, err: `insert: ${insErr.message}` });
      }

      // Squads multisig instruction — surface as multisig-change (we'll refine subtypes later)
      const squadsIx = ixs.find((ix) => ix.programId === SQUADS_V4);
      if (squadsIx) {
        summary.multisig_changes_detected++;
        const { error: insErr } = await admin.from("account_signals").insert({
          company_slug: a.company_slug, signal_type: "onchain-multisig", signal_subtype: "squads-instruction",
          source: "onchain-solana",
          title: `${companyName}: Squads multisig activity${a.label ? ` (${a.label})` : ""}`,
          detail: `Squads v4 instruction in tx ${s.signature.slice(0, 16)}… at slot ${s.slot}. Multisig action — may indicate ops/governance change.`,
          evidence_url: txUrl, fired_at: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : new Date().toISOString(),
          score_boost: 70,
          raw_data: { chain: "solana", program_id: programId, signature: s.signature, slot: s.slot },
        });
        if (!insErr) summary.signals_inserted++;
        else if (insErr.code !== "23505") summary.errors.push({ slug: a.company_slug, err: `insert: ${insErr.message}` });
      }
    }

    if (maxSlotSeen > lastSlot) {
      await admin.from("chain_addresses").update({ last_seen_block: maxSlotSeen, updated_at: new Date().toISOString() }).eq("id", a.id);
    }
  }

  return json(200, { ok: true, summary });
});
