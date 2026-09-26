// HEAD-checks audit_history.report_url against the web. Sets report_url_status = valid|invalid|error.
// Lets the UI gate the 'Report' button on /audit-reports + /protocol pages so we never serve a dead PDF link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function headCheck(url: string): Promise<"valid" | "invalid" | "error"> {
  try {
    // HEAD first (cheap); fall back to GET if HEAD is rejected (some servers don't support HEAD)
    let r = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "AuditScope-LinkVerifier/1.0" } });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "AuditScope-LinkVerifier/1.0" } });
    }
    if (r.status >= 200 && r.status < 300) return "valid";
    if (r.status === 404 || r.status === 410 || r.status === 403) return "invalid";
    return "error";
  } catch { return "error"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; retry_errors?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 100);

  let q = admin.from("audit_history")
    .select("id, report_url")
    .not("report_url", "is", null)
    .limit(limit);
  if (body.retry_errors) q = q.eq("report_url_status", "error");
  else q = q.is("report_url_status", null);

  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let valid = 0, invalid = 0, errored = 0;
  const PARALLEL = 6;
  for (let i = 0; i < rows.length; i += PARALLEL) {
    const chunk = rows.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map(async (r: any) => ({ id: r.id, status: await headCheck(r.report_url) })));
    for (const r of results) {
      if (r.status === "valid") valid++;
      else if (r.status === "invalid") invalid++;
      else errored++;
      await admin.from("audit_history").update({ report_url_status: r.status }).eq("id", r.id);
    }
  }
  return json(200, { ok: true, scanned: rows.length, valid, invalid, errored });
});
