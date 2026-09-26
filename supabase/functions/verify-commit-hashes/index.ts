// v6 — Strict org-fallback: rescue only when the namespace is a real Organization
// (NOT a user) AND has at least one public repository. Filters out squatted usernames
// like 'sky-protocol' that exist but are empty/random.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

type Status = "valid" | "invalid" | "error";
function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}
async function ghFetch(path: string, ghToken: string | null): Promise<{ status: number; json?: any }> {
  const headers: Record<string, string> = { "User-Agent": "AuditScope-Verifier/6.0", "Accept": "application/vnd.github+json" };
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
  try {
    const r = await fetch(`https://api.github.com${path}`, { method: "GET", headers, redirect: "follow" });
    if (r.status === 200) { try { return { status: 200, json: await r.json() }; } catch { return { status: 200 }; } }
    return { status: r.status };
  } catch { return { status: 0 }; }
}
function statusFromCode(c: number): Status {
  if (c === 200) return "valid";
  if (c === 404 || c === 410 || c === 422) return "invalid";
  return "error";
}

// STRICT: only rescue when namespace is type=Organization with public_repos > 0.
async function checkOrgFallback(name: string, ghToken: string | null): Promise<Status> {
  const org = await ghFetch(`/orgs/${name}`, ghToken);
  if (org.status === 200 && org.json) {
    const type = org.json.type;            // "Organization"
    const publicRepos = Number(org.json.public_repos ?? 0);
    if (type === "Organization" && publicRepos > 0) return "valid";
    return "invalid";  // org exists but empty/wrong-type — NOT useful as a fallback
  }
  if (org.status === 404) return "invalid";  // user accounts intentionally skipped
  return "error";
}

async function verifyAndRepair(repoUrl: string, hash: string | null, ghToken: string | null) {
  const parsed = parseRepo(repoUrl);
  if (!parsed) return { repo: "invalid" as Status, commit: hash ? "invalid" as Status : null, org: null as Status | null };
  const direct = await ghFetch(`/repos/${parsed.owner}/${parsed.repo}`, ghToken);
  if (direct.status === 200) {
    const actualFullName: string | undefined = direct.json?.full_name;
    let finalOwner = parsed.owner, finalRepo = parsed.repo;
    let newRepoUrl: string | undefined;
    if (actualFullName && actualFullName.toLowerCase() !== `${parsed.owner}/${parsed.repo}`.toLowerCase()) {
      const np = actualFullName.split("/");
      if (np.length === 2) {
        finalOwner = np[0]; finalRepo = np[1];
        newRepoUrl = `https://github.com/${finalOwner}/${finalRepo}`;
      }
    }
    let commit: Status | null = null;
    if (hash) {
      if (!/^[a-f0-9]{7,64}$/i.test(hash)) commit = "invalid";
      else {
        const c = await ghFetch(`/repos/${finalOwner}/${finalRepo}/commits/${hash}`, ghToken);
        commit = statusFromCode(c.status);
      }
    }
    return { repo: "valid" as Status, commit, newRepoUrl, rescuedVia: newRepoUrl ? "redirect" as const : undefined, org: "valid" as Status };
  }
  if (direct.status === 404 || direct.status === 410) {
    const orgStatus = await checkOrgFallback(parsed.owner, ghToken);
    return { repo: "invalid" as Status, commit: hash ? "invalid" as Status : null, org: orgStatus };
  }
  return { repo: statusFromCode(direct.status), commit: hash ? statusFromCode(direct.status) : null, org: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ghToken = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("GH_TOKEN") || null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; retry_invalid?: boolean; backfill_org?: boolean; revalidate_org?: boolean; commit_backfill?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

  let q = admin.from("audit_history")
    .select("id, audited_repo_url, audited_commit_hash, repo_url_status, org_url_status")
    .not("audited_repo_url", "is", null)
    .like("audited_repo_url", "%github.com%")
    .limit(limit);
  if (body.commit_backfill) {
    // Rows whose repo already verified but whose commit hash was never checked.
    // None of the other modes reach these: they all key on repo_url_status.
    q = q.eq("repo_url_status", "valid").not("audited_commit_hash", "is", null).is("commit_hash_status", null);
  } else if (body.revalidate_org) {
    // Re-check rows we'd previously marked org_url_status='valid' under v5
    q = q.eq("repo_url_status", "invalid").eq("org_url_status", "valid");
  } else if (body.backfill_org) {
    q = q.eq("repo_url_status", "invalid").is("org_url_status", null);
  } else if (body.retry_invalid) {
    q = q.eq("repo_url_status", "invalid");
  } else {
    q = q.is("repo_url_status", null);
  }

  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let repoValid = 0, repoInvalid = 0, repoError = 0, orgValid = 0, orgInvalid = 0, rescuedByRedirect = 0;
  const PARALLEL = 4;
  for (let i = 0; i < rows.length; i += PARALLEL) {
    const chunk = rows.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map(async (r: any) => ({
      id: r.id, origUrl: r.audited_repo_url,
      ...(await verifyAndRepair(r.audited_repo_url, r.audited_commit_hash, ghToken)),
    })));
    for (const r of results) {
      if (r.repo === "valid") repoValid++;
      else if (r.repo === "invalid") repoInvalid++;
      else repoError++;
      if (r.org === "valid") orgValid++;
      else if (r.org === "invalid") orgInvalid++;
      if (r.rescuedVia === "redirect") rescuedByRedirect++;
      const update: any = { repo_url_status: r.repo };
      if (r.commit !== null) update.commit_hash_status = r.commit;
      if (r.org !== null && r.org !== undefined) update.org_url_status = r.org;
      if (r.newRepoUrl) update.audited_repo_url = r.newRepoUrl;
      await admin.from("audit_history").update(update).eq("id", r.id);
    }
  }
  return json(200, {
    ok: true, scanned: rows.length, repo_valid: repoValid, repo_invalid: repoInvalid, repo_error: repoError,
    org_valid: orgValid, org_invalid: orgInvalid, rescued_by_redirect: rescuedByRedirect, has_token: !!ghToken,
  });
});
