import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const W3L_URL = "https://wwwfoeuebjmbuxqwwpjq.supabase.co/functions/v1/web3leads-api";
const PAGE_SIZE = 100;
const SOURCE = "web3leads_funds";
// Wall-clock budget per invocation. The edge runtime caps a request at 150s;
// stop starting new pages well before that and hand the cursor to the next call.
const TIME_BUDGET_MS = 110_000;
// The worker also has a CPU cap (546 WORKER_RESOURCE_LIMIT); a first pass that
// links every row ran out at ~30 pages. Keep each call well under that.
const MAX_PAGES_PER_CALL = 12;
// A run holding the lock longer than this is assumed dead (the worker caps a
// request at 150s), so the next call may take over.
const LOCK_STALE_MS = 3 * 60_000;
// Prune only when a completed pass saw at least this share of the last known total.
const PRUNE_MIN_SHARE = 0.98;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return (s || "").toString().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function normName(s: string): string { return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").trim(); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pick the square/icon-style logo over the wide banner. Web3leads convention:
// logo_url_2 (when present) = secondary/square asset; logo_url = primary/banner.
function pickLogo(f: any): string | null {
  return f.logo_url_2 || f.logo_url || f.logo || null;
}

// web3leads-api lives on another Supabase project, so every call counts against
// the edge runtime's function-to-function limit. After ~30 calls fetch() throws
// "RateLimitError ... Retry after NNNNms". The old loop treated that as the end
// of the data and synced a partial list as if it were complete — the funds past
// row 3,000 never arrived. Wait the stated time and retry instead.
async function fetchPage(key: string, offset: number, deadline: number): Promise<{ rows: any[] } | { error: string; retryable: boolean }> {
  // Ordered by id: unique and immutable, so offset pages neither overlap nor skip
  // while upstream rows are edited (updated_at ordering shuffled them mid-pass).
  const body = { resource: "funds", limit: PAGE_SIZE, offset, order: { column: "id", ascending: true } };
  for (let attempt = 1; attempt <= 4; attempt++) {
    let waitMs = 0;
    try {
      const resp = await fetch(W3L_URL, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (resp.ok) {
        const j = await resp.json().catch(() => null);
        const rows = Array.isArray(j) ? j : (j?.data || j?.rows || j?.results);
        if (!Array.isArray(rows)) return { error: `bad_body at offset ${offset}`, retryable: true };
        return { rows };
      }
      const txt = await resp.text().catch(() => "");
      if (resp.status !== 429 && resp.status < 500) return { error: `w3l_${resp.status}: ${txt.slice(0, 200)}`, retryable: false };
      waitMs = Number(resp.headers.get("retry-after") || 0) * 1000 || 5000 * attempt;
    } catch (e) {
      const msg = String(e);
      const m = msg.match(/Retry after (\d+)ms/i);
      if (!m && !/rate ?limit/i.test(msg)) waitMs = 2000 * attempt;
      else waitMs = (m ? Number(m[1]) : 30000) + 1000;
    }
    if (Date.now() + waitMs > deadline) return { error: `rate_limited at offset ${offset}; resuming next call`, retryable: true };
    await sleep(waitMs);
  }
  return { error: `gave up at offset ${offset} after 4 attempts`, retryable: true };
}

async function fetchAllExistingFunds(admin: any): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50000; offset += PAGE) {
    const { data, error } = await admin.from("funds").select("slug,name,logo,website,twitter,linkedin,description,investment_count,w3l_id").order("slug").range(offset, offset + PAGE - 1);
    if (error) throw new Error(`read funds: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const w3lKey = Deno.env.get("WEB3LEADS_API_KEY");
  if (!w3lKey) return json(500, { error: "Missing WEB3LEADS_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { restart?: boolean; debug?: boolean; force_overwrite_logo?: boolean };
  const debug = body.debug === true;
  const forceLogo = body.force_overwrite_logo === true;

  // A full pass spans several invocations; the cursor lives in sync_counts.
  const { data: state } = await admin.from("sync_counts").select("cursor_offset,pass_seen,expected").eq("source", SOURCE).maybeSingle();
  let offset = body.restart ? 0 : (state?.cursor_offset ?? 0);
  let passSeen = body.restart ? 0 : (state?.pass_seen ?? 0);

  if (debug) {
    const r = await fetchPage(w3lKey, offset, deadline);
    if ("error" in r) return json(200, { ok: false, offset, error: r.error });
    return json(200, { ok: true, offset, fetched: r.rows.length, first_id: r.rows[0]?.id, last_id: r.rows.at(-1)?.id, sample_keys: Object.keys(r.rows[0] || {}) });
  }

  // One run at a time: the 10-minute cron and a manual call must not interleave
  // cursor writes or race on inserts.
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data: lock } = await admin.from("sync_counts")
    .update({ running_since: new Date().toISOString() })
    .eq("source", SOURCE)
    .or(`running_since.is.null,running_since.lt.${staleBefore}`)
    .select("source");
  if (!lock || lock.length === 0) return json(200, { ok: true, skipped: "another run is in progress" });

  // A new pass starts with an empty seen-set; the prune compares against it.
  if (offset === 0 && passSeen === 0) {
    const { error } = await admin.from("sync_seen_ids").delete().eq("source", SOURCE);
    if (error) {
      await admin.from("sync_counts").update({ running_since: null }).eq("source", SOURCE);
      return json(500, { error: `reset seen ids: ${error.message}` });
    }
  }

  const existingFunds = await fetchAllExistingFunds(admin);
  const byW3l = new Map<string, any>();
  const bySlug = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const f of existingFunds) {
    if (f.w3l_id) byW3l.set(String(f.w3l_id), f);
    if (f.slug) bySlug.set(f.slug.toLowerCase(), f);
    const nn = normName(f.name || "");
    if (nn && !byName.has(nn)) byName.set(nn, f);
  }

  let inserted = 0, updated = 0, fieldsFilled = 0, no_change = 0, matched_by_name = 0, logos_overwritten = 0, linked = 0, skipped_nameless = 0;
  let complete = false, notice: string | undefined;
  const errors: string[] = [];

  const saveCursor = (patch: Record<string, unknown>) =>
    admin.from("sync_counts").update({ ...patch, last_run_at: new Date().toISOString() }).eq("source", SOURCE);

  for (let pages = 0; pages < MAX_PAGES_PER_CALL && Date.now() < deadline; pages++) {
    const page = await fetchPage(w3lKey, offset, deadline);
    if ("error" in page) { notice = page.error; if (!page.retryable) errors.push(page.error); break; }
    const rows = page.rows;

    // Record every upstream id on the page, whatever happens to the row below.
    const ids = rows.map((f: any) => f.id).filter((x: unknown) => x != null).map((x: unknown) => ({ source: SOURCE, upstream_id: String(x) }));
    if (ids.length) {
      const { error } = await admin.from("sync_seen_ids").upsert(ids, { onConflict: "source,upstream_id", ignoreDuplicates: true });
      // A short seen-set only makes the prune guard refuse; never a wrong delete.
      if (error) errors.push(`seen ids: ${error.message}`);
    }

    for (const f of rows) {
      const w3lId = f.id != null ? String(f.id) : null;
      const name = (f.name || "").trim();
      if (!w3lId || !name) { skipped_nameless++; continue; }
      const newFields = {
        logo: pickLogo(f),
        website: f.website || null,
        twitter: f.twitter || null,
        linkedin: f.linkedin || null,
        description: f.description || f.bio || null,
        investment_count: typeof f.investment_count === "number" ? f.investment_count : null,
        last_updated: new Date().toISOString(),
      };

      // Match on the upstream id first. Slug/name matching is only for rows
      // that predate w3l_id, and never claims a row another fund already owns —
      // that is how two distinct funds sharing a name used to collapse into one.
      let existing = byW3l.get(w3lId);
      if (!existing) {
        const baseSlug = (f.slug || slugify(name)).toLowerCase();
        let cand = bySlug.get(baseSlug);
        if (!cand) { cand = byName.get(normName(name)); if (cand && !cand.w3l_id) matched_by_name++; }
        if (cand && !cand.w3l_id) existing = cand;
      }

      if (!existing) {
        let slug = (f.slug || slugify(name)).toLowerCase() || `fund-${w3lId.slice(0, 8)}`;
        if (bySlug.has(slug)) slug = `${slug}-${w3lId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
        const row = { slug, name, w3l_id: w3lId, ...newFields, data_source: "web3leads" };
        const { error } = await admin.from("funds").insert(row);
        if (error) { errors.push(`insert ${slug}: ${error.message}`); continue; }
        inserted++;
        byW3l.set(w3lId, row); bySlug.set(slug, row);
        if (!byName.has(normName(name))) byName.set(normName(name), row);
        continue;
      }

      const updates: any = {};
      if (!existing.w3l_id) { updates.w3l_id = w3lId; linked++; }
      // Force-overwrite logo with the new picker so existing ugly banner-logos get replaced by squares
      if (newFields.logo && (forceLogo || !existing.logo || existing.logo !== newFields.logo)) {
        updates.logo = newFields.logo;
        if (existing.logo && existing.logo !== newFields.logo) logos_overwritten++;
      }
      if (!existing.website && newFields.website) updates.website = newFields.website;
      if (!existing.twitter && newFields.twitter) updates.twitter = newFields.twitter;
      if (!existing.linkedin && newFields.linkedin) updates.linkedin = newFields.linkedin;
      if (!existing.description && newFields.description) updates.description = newFields.description;
      if (newFields.investment_count != null && newFields.investment_count !== existing.investment_count) updates.investment_count = newFields.investment_count;
      if (Object.keys(updates).length === 0) { no_change++; continue; }
      updates.last_updated = newFields.last_updated;
      fieldsFilled += Object.keys(updates).length;
      const { error } = await admin.from("funds").update(updates).eq("slug", existing.slug);
      if (error) { errors.push(`update ${existing.slug}: ${error.message}`); continue; }
      updated++;
      Object.assign(existing, updates);
      byW3l.set(w3lId, existing);
    }

    passSeen += rows.length;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) { complete = true; break; }
    // Persist per page so a worker kill resumes here instead of from zero.
    await saveCursor({ cursor_offset: offset, pass_seen: passSeen });
  }

  // Prune rows this pass didn't see, only after a complete pass. The SQL
  // function re-checks the 98% guard against its own count of seen ids.
  let prune: any = null;
  if (complete) {
    const prevExpected = state?.expected ?? null;
    if (prevExpected == null || passSeen < Math.ceil(prevExpected * PRUNE_MIN_SHARE)) {
      prune = { pruned: 0, skipped: `pass saw ${passSeen}, below 98% of expected ${prevExpected ?? "unknown"}` };
    } else {
      const { data, error } = await admin.rpc("prune_orphan_funds", { p_expected: prevExpected, p_pass_seen: passSeen });
      prune = error ? { pruned: 0, skipped: `prune failed: ${error.message}` } : data;
      if (error) errors.push(`prune: ${error.message}`);
    }
  }

  const { count: received } = await admin.from("funds").select("slug", { count: "exact", head: true }).not("w3l_id", "is", null);
  const now = new Date().toISOString();
  const stateUpdate: any = { received, last_run_at: now, last_error: errors[0] ?? notice ?? null, running_since: null };
  if (prune) {
    Object.assign(stateUpdate, { last_pruned: prune.pruned ?? 0, last_prune_at: now, last_prune_note: prune.skipped ?? `pruned ${prune.pruned} of ${prune.candidates} candidates` });
  }
  if (complete) {
    // Only a pass that reached the last page may set the expected total.
    Object.assign(stateUpdate, { expected: passSeen, complete_at: now, cursor_offset: 0, pass_seen: 0 });
  } else {
    Object.assign(stateUpdate, { cursor_offset: offset, pass_seen: passSeen });
  }
  await admin.from("sync_counts").update(stateUpdate).eq("source", SOURCE);

  return json(200, {
    ok: errors.length === 0, complete, next_offset: complete ? 0 : offset, pass_seen: passSeen,
    expected: complete ? passSeen : undefined, received,
    inserted, updated, linked, matched_by_name, logos_overwritten, fields_filled: fieldsFilled, no_change, skipped_nameless,
    pruned: prune?.pruned, prune_skipped: prune?.skipped, prune_details: prune?.details,
    elapsed_ms: Date.now() - started, errors: errors.slice(0, 5), notice,
  });
});
