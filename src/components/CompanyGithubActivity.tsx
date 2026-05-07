import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ghHeaders, parseGithubRepo } from "@/lib/liveData";
import { LangBadge } from "@/components/LangBadge";

const PERIODS = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

export function CompanyGithubActivity({ githubUrls }: { githubUrls: string[] }) {
  const [days, setDays] = useState(30);

  const repos = Array.from(
    new Set(
      githubUrls
        .map((u) => {
          const r = parseGithubRepo(u);
          return r ? `${r.owner}/${r.repo}` : null;
        })
        .filter(Boolean) as string[],
    ),
  );

  const q = useQuery({
    queryKey: ["company-gh", repos.join(","), days],
    enabled: repos.length > 0,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const headers = ghHeaders();
      let totalCommits = 0;
      let lastCommitDate: string | null = null;
      let lastCommitRepo: string | null = null;
      let reposWithData = 0;
      const languages = new Set<string>();
      await Promise.all(
        repos.map(async (full) => {
          try {
            const [commitsR, repoR] = await Promise.all([
              fetch(
                `https://api.github.com/repos/${full}/commits?since=${encodeURIComponent(since)}&per_page=100`,
                { headers },
              ),
              fetch(`https://api.github.com/repos/${full}`, { headers }),
            ]);
            if (repoR.ok) {
              const rd = await repoR.json();
              if (rd?.language) languages.add(rd.language);
            }
            if (!commitsR.ok) return;
            const arr = await commitsR.json();
            if (!Array.isArray(arr)) return;
            reposWithData += 1;
            totalCommits += arr.length;
            for (const c of arr) {
              const d = c.commit?.author?.date;
              if (d && (!lastCommitDate || d > lastCommitDate)) {
                lastCommitDate = d;
                lastCommitRepo = full;
              }
            }
          } catch {
            /* ignore */
          }
        }),
      );
      return {
        totalCommits,
        lastCommitDate,
        lastCommitRepo,
        reposCount: reposWithData || repos.length,
        languages: Array.from(languages),
      };
    },
  });

  if (repos.length === 0) return null;
  if (!q.isLoading && (!q.data || (q.data.totalCommits === 0 && q.data.languages.length === 0 && !q.data.lastCommitDate))) {
    return null;
  }

  return (
    <div className="as-card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white">GitHub Activity</h3>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                days === p.days
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-white/5 text-muted-foreground border-white/10 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <div className="h-16 bg-white/[0.03] rounded animate-pulse" />
      ) : !q.data ? (
        <div className="text-sm text-muted-foreground py-4">—</div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="font-mono text-lg text-white">
            {q.data.totalCommits} total commits across {q.data.reposCount} repo{q.data.reposCount === 1 ? "" : "s"} in last {days} days
          </div>
          {q.data.lastCommitRepo && (
            <div className="text-xs text-muted-foreground">
              Most recent:{" "}
              <a
                href={`https://github.com/${q.data.lastCommitRepo}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-primary hover:underline"
              >
                {q.data.lastCommitRepo}
              </a>{" "}
              <span className="font-mono text-white">
                {q.data.lastCommitDate ? `· ${format(new Date(q.data.lastCommitDate), "MMM d, yyyy")}` : ""}
              </span>
            </div>
          )}
          {q.data.languages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {q.data.languages.map((l) => (
                <LangBadge key={l} language={l} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
