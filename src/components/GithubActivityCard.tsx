import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { LangBadge } from "@/components/LangBadge";

const GH_HEADERS: HeadersInit = {
  Authorization: "Bearer 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",
  Accept: "application/vnd.github.v3+json",
};

function parseGithubUrl(url: string | null | undefined): { owner: string; repo: string | null } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const owner = parts[0];
    const repo = parts.length >= 2 ? parts[1].replace(/\.git$/, "") : null;
    return { owner, repo };
  } catch {
    return null;
  }
}

export function GithubActivityCard({
  githubUrls,
  protocolName,
}: {
  githubUrls: string[] | null | undefined;
  protocolName?: string | null;
}) {
  const url = githubUrls?.[0] || null;
  const parsed = parseGithubUrl(url);

  const q = useQuery({
    queryKey: ["gh-protocol", parsed?.owner, parsed?.repo, protocolName],
    enabled: !!parsed || !!protocolName,
    queryFn: async () => {
      const headers = GH_HEADERS;
      let owner: string | null = parsed?.owner ?? null;
      let repo: string | null = parsed?.repo ?? null;

      const PREFER = ["contract", "core", "protocol", "smart", "token", "vault", "pool", "dex", "swap", "lending", "staking"];
      const EXCLUDE = ["demo", "docs", "documentation", "example", "test", "website", "landing", "frontend", "ui", "invoice"];
      const pickBest = (arr: any[]): any | null => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const nameOf = (x: any) => String(x?.name || "").toLowerCase();
        const filtered = arr.filter((x: any) => !EXCLUDE.some((w) => nameOf(x).includes(w)));
        const pool = filtered.length > 0 ? filtered : arr;
        const sortedByStars = [...pool].sort(
          (a: any, b: any) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0),
        );
        const preferred = sortedByStars.find((x: any) => PREFER.some((w) => nameOf(x).includes(w)));
        return preferred || sortedByStars[0] || null;
      };

      if (!owner) {
        if (!protocolName) return null;
        const sr = await fetch(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(protocolName)}+in:name&sort=stars&per_page=20`,
          { headers },
        ).catch(() => null);
        if (!sr || !sr.ok) return null;
        const sd = await sr.json();
        const item = pickBest(sd?.items || []);
        if (!item) return null;
        owner = item.owner?.login;
        repo = item.name;
        if (!owner || !repo) return null;
      }

      if (!repo) {
        const fetchRepos = async (kind: "orgs" | "users") => {
          const r = await fetch(
            `https://api.github.com/${kind}/${owner}/repos?sort=stars&per_page=20`,
            { headers },
          ).catch(() => null);
          if (!r || !r.ok) return null;
          const arr = await r.json();
          return Array.isArray(arr) ? arr : null;
        };
        let arr = await fetchRepos("orgs");
        if (!arr) arr = await fetchRepos("users");
        const chosen = pickBest(arr || []);
        if (!chosen) return null;
        repo = chosen.name;
        owner = chosen.owner?.login || owner;
      }

      const base = `https://api.github.com/repos/${owner}/${repo}`;
      const [repoR, auditsR] = await Promise.all([
        fetch(base, { headers }).catch(() => null),
        fetch(`${base}/contents/audits`, { headers }).catch(() => null),
      ]);
      if (!repoR || !repoR.ok) return null;
      const repoData = await repoR.json();
      const auditsData = auditsR && auditsR.ok ? await auditsR.json() : null;
      const auditFiles = Array.isArray(auditsData) ? auditsData.filter((f: any) => f.type === "file").length : 0;
      return {
        owner,
        repo: repo!,
        repoUrl: `https://github.com/${owner}/${repo}`,
        language: repoData?.language ?? null,
        stars: repoData?.stargazers_count ?? null,
        openIssues: repoData?.open_issues_count ?? null,
        lastCommitDate: repoData?.pushed_at ?? null,
        auditFiles,
        auditsUrl: `https://github.com/${owner}/${repo}/tree/main/audits`,
      };
    },
  });

  if (!parsed && !protocolName) return null;
  if (q.isLoading) {
    return (
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">GitHub Activity</h3>
        <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
      </div>
    );
  }
  if (!q.data) return null;

  return (
    <div className="as-card p-5">
      <h3 className="text-sm font-semibold text-white mb-3">GitHub Activity</h3>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Repo</span>
          <a
            href={q.data.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
          >
            {q.data.owner}/{q.data.repo} <ExternalLink className="w-3 h-3" />
          </a>
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
          <span className="text-muted-foreground">Last commit</span>
          <span className="font-mono text-xs text-white">
            {q.data.lastCommitDate
              ? `${formatDistanceToNow(new Date(q.data.lastCommitDate))} ago`
              : "—"}
          </span>
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
              View audit files on GitHub <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
