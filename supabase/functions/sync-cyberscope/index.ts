// sync-cyberscope — the enumeration step that was missing from the CyberScope
// pipeline. The four insert-* functions are caller-driven sinks; nothing walked
// the source repo, which is why none of them was ever scheduled.
//
// One GitHub tree call (recursive) lists every <folder>/audit.pdf in
// cyberscope-io/audits, then hands the paths to bulk-ingest-cyberscope, which
// owns dedup (raw_pdf_url + lower(report_url) + within-batch) and is idempotent.
//
// Deliberately does NOT touch insert-cyberscope-findings: that function has no
// dedup and would duplicate findings on every run.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";

const OWNER = "cyberscope-io";
const REPO = "audits";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AuditScope-SyncCyberScope/1.0",
  };
  if (GH_TOKEN) h.Authorization = `Bearer ${GH_TOKEN}`;
  return h;
}

Deno.serve(async (req) => {
  if (CRON_KEY === "" || req.headers.get("x-cron-key") !== CRON_KEY) {
    return json(401, { error: "Unauthorized" });
  }
  const t0 = Date.now();
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; limit?: number };

  // Follow the repo's actual default branch rather than assuming "main".
  const metaRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: ghHeaders() });
  if (!metaRes.ok) {
    return json(502, { error: "repo_meta_failed", status: metaRes.status, detail: (await metaRes.text()).slice(0, 200) });
  }
  const branch = ((await metaRes.json()) as { default_branch?: string }).default_branch || "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders() },
  );
  if (!treeRes.ok) {
    return json(502, { error: "tree_failed", status: treeRes.status, detail: (await treeRes.text()).slice(0, 200) });
  }
  const tree = (await treeRes.json()) as { truncated?: boolean; tree?: Array<{ path: string; type: string }> };

  let paths = (tree.tree || [])
    .filter((e) => e.type === "blob" && e.path.endsWith("/audit.pdf"))
    .map((e) => e.path);
  const total = paths.length;
  if (body.limit && body.limit > 0) paths = paths.slice(0, body.limit);

  if (body.dry_run) {
    return json(200, {
      ok: true, dry_run: true, branch, truncated: !!tree.truncated,
      audit_pdf_paths: total, sample: paths.slice(0, 5), elapsed_ms: Date.now() - t0,
    });
  }
  if (paths.length === 0) {
    return json(200, { ok: true, branch, audit_pdf_paths: 0, note: "nothing to ingest" });
  }

  // bulk-ingest-cyberscope owns dedup; re-sending every path each run is safe.
  const ingRes = await fetch(`${SUPABASE_URL}/functions/v1/bulk-ingest-cyberscope`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-key": CRON_KEY },
    body: JSON.stringify({ paths }),
  });
  const ingText = await ingRes.text();
  let ingest: unknown;
  try { ingest = JSON.parse(ingText); } catch { ingest = ingText.slice(0, 400); }

  return json(ingRes.ok ? 200 : 502, {
    ok: ingRes.ok, branch, truncated: !!tree.truncated,
    audit_pdf_paths: total, sent: paths.length,
    ingest, elapsed_ms: Date.now() - t0,
  });
});
