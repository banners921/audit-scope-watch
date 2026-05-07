import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ghHeaders, parseGithubRepo } from "@/lib/liveData";
import { LangBadge } from "@/components/LangBadge";

export function GithubActivityCard({ githubUrls }: { githubUrls: string[] | null | undefined }) {
  const url = githubUrls?.[0] || null;
  const repo = parseGithubRepo(url);

  const q = useQuery({
    queryKey: ["gh-protocol", repo?.owner, repo?.repo],
    enabled: !!repo,
    queryFn: async () => {
      if (!repo) return null;
      const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
      const headers = ghHeaders();
      const [repoR, commitsR, auditsR] = await Promise.all([
        fetch(base, { headers }).catch(() => null),
        fetch(`${base}/commits?per_page=1`, { headers }).catch(() => null),
        fetch(`${base}/contents/audits`, { headers }).catch(() => null),
      ]);
      const repoData = repoR && repoR.ok ? await repoR.json() : null;
      const commits = commitsR && commitsR.ok ? await commitsR.json() : null;
      const auditsData = auditsR && auditsR.ok ? await auditsR.json() : null;
      const lastCommitDate =
        Array.isArray(commits) && commits[0]?.commit?.author?.date ? commits[0].commit.author.date : null;
      const auditFiles = Array.isArray(auditsData) ? auditsData.filter((f: any) => f.type === "file").length : 0;
      return {
        language: repoData?.language ?? null,
        stars: repoData?.stargazers_count ?? null,
        openIssues: repoData?.open_issues_count ?? null,
        lastCommitDate,
        auditFiles,
        auditsUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/HEAD/audits`,
      };
    },
  });

  return (
    <div className="as-card p-5">
      <h3 className="text-sm font-semibold text-white mb-3">GitHub Activity</h3>
      {!repo ? (
        <div className="text-sm text-muted-foreground py-4">No GitHub data</div>
      ) : q.isLoading ? (
        <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
      ) : !q.data ? (
        <div className="text-sm text-muted-foreground py-4">—</div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last commit</span>
            <span className="font-mono text-xs text-white">
              {q.data.lastCommitDate
                ? `${formatDistanceToNow(new Date(q.data.lastCommitDate))} ago`
                : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Language</span>
            {q.data.language ? <LangBadge language={q.data.language} /> : <span className="text-muted-foreground">—</span>}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Stars</span>
            <span className="font-mono text-white">{q.data.stars ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Open issues</span>
            <span className="font-mono text-white">{q.data.openIssues ?? "—"}</span>
          </div>
          {q.data.auditFiles > 0 && (
            <div className="pt-2 border-t border-white/[0.05]">
              <a
                href={q.data.auditsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {q.data.auditFiles} audit files on GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
