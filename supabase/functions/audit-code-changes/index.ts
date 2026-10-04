import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// "Code changes since this audit": GitHub compare between the commit the report
// says was audited and the repo's default-branch HEAD at fetch time. Stats only
// (files changed, lines added/removed) — nothing is cloned, no diff is stored.
// Results are cached per audit in audit_code_changes; refresh is on demand.
//
// Eligibility is audit_code_change_eligible() in Postgres, the same check the
// page uses, so the two can't disagree.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
// A refresh inside this window returns the cached row instead of calling GitHub.
const MIN_REFRESH_MS = 10 * 60_000;
const GH_FILE_CAP = 300; // compare API lists at most 300 files

function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

async function gh(path: string, token: string | null): Promise<{ status: number; json?: any }> {
  const headers: Record<string, string> = { "User-Agent": "AuditScope-CodeChanges/1.0", "Accept": "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (r.status === 200) return { status: 200, json: await r.json().catch(() => null) };
    return { status: r.status };
  } catch { return { status: 0 }; }
}

function ghError(what: string, status: number): string {
  if (status === 404) return `${what}: not found on GitHub (repo or commit deleted, made private, or force-pushed away)`;
  if (status === 403 || status === 429) return `${what}: GitHub rate limit — try again later`;
  if (status === 0) return `${what}: GitHub did not respond`;
  return `${what}: GitHub returned ${status}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Same gate as the app's protected routes: a signed-in user.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "missing auth" });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json(401, { error: "invalid auth" });

  const body = (await req.json().catch(() => ({}))) as { audit_id?: string; refresh?: boolean };
  const auditId = String(body.audit_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(auditId)) return json(400, { error: "audit_id required" });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: eligible, error: eErr } = await admin.rpc("audit_code_change_eligible", { p_id: auditId });
  if (eErr) return json(500, { error: eErr.message });
  if (!eligible) return json(422, { error: "not eligible: no report-stated, GitHub-confirmed commit with a verified repo" });

  const { data: cached } = await admin.from("audit_code_changes").select("*").eq("audit_id", auditId).maybeSingle();
  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < MIN_REFRESH_MS;
  if (cached && (!body.refresh || fresh)) return json(200, { ...cached, cached: true });

  const { data: audit, error: aErr } = await admin.from("audit_history").select("audited_repo_url,audited_commit_hash").eq("id", auditId).single();
  if (aErr || !audit) return json(404, { error: "audit not found" });
  const parsed = parseRepo(audit.audited_repo_url);
  if (!parsed) return json(422, { error: "repo URL is not a GitHub repo" });
  const base = String(audit.audited_commit_hash).toLowerCase();
  const token = Deno.env.get("GITHUB_TOKEN") || null;

  const row: Record<string, unknown> = {
    audit_id: auditId, owner: parsed.owner, repo: parsed.repo, base_commit: base,
    default_branch: null, head_sha: null, compare_status: null, ahead_by: null, behind_by: null,
    files_changed: null, additions: null, deletions: null, files_truncated: false,
    compare_url: null, error: null, fetched_at: new Date().toISOString(),
  };

  // 1) default branch (follows renames: GitHub redirects old owner/repo names)
  const repoRes = await gh(`/repos/${parsed.owner}/${parsed.repo}`, token);
  if (repoRes.status !== 200 || !repoRes.json?.default_branch) {
    row.error = ghError("repository", repoRes.status);
  } else {
    const owner = repoRes.json.owner?.login || parsed.owner;
    const repo = repoRes.json.name || parsed.repo;
    row.owner = owner; row.repo = repo;
    const branch = repoRes.json.default_branch as string;
    row.default_branch = branch;
    // 2) pin HEAD to a sha so the stored stats and the link describe the same diff
    const br = await gh(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, token);
    const headSha = br.json?.commit?.sha as string | undefined;
    if (br.status !== 200 || !headSha) {
      row.error = ghError(`default branch ${branch}`, br.status);
    } else {
      row.head_sha = headSha;
      row.compare_url = `https://github.com/${owner}/${repo}/compare/${base}...${headSha}`;
      // 3) compare. per_page=1 keeps the commit list small; the files list is
      // returned in full (up to GitHub's 300-file cap) regardless.
      const cmp = await gh(`/repos/${owner}/${repo}/compare/${base}...${headSha}?per_page=1`, token);
      if (cmp.status !== 200 || !cmp.json) {
        row.error = ghError("compare", cmp.status);
      } else {
        const files = Array.isArray(cmp.json.files) ? cmp.json.files : [];
        row.compare_status = cmp.json.status ?? null;
        row.ahead_by = cmp.json.ahead_by ?? null;
        row.behind_by = cmp.json.behind_by ?? null;
        row.files_changed = files.length;
        row.additions = files.reduce((s: number, f: any) => s + (f.additions || 0), 0);
        row.deletions = files.reduce((s: number, f: any) => s + (f.deletions || 0), 0);
        row.files_truncated = files.length >= GH_FILE_CAP;
      }
    }
  }

  const { data: saved, error: sErr } = await admin.from("audit_code_changes").upsert(row).select("*").single();
  if (sErr) return json(500, { error: sErr.message });
  return json(200, { ...saved, cached: false });
});
