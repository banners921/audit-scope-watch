import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Github,
  Linkedin,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Target,
  X,
  Send as TelegramIcon,
  Crown,
  Code,
  ExternalLink,
  Check,
  Shield,
  Sprout,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ghHeaders } from "@/lib/liveData";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  open: boolean;
  onClose: () => void;
  companySlug: string;
  companyName: string;
  companyUrl?: string | null;
  companyCategory?: string | null;
  isInstitution?: boolean | null;
  githubUrls: string[];
};

type Relevance = "security" | "web3" | "leadership" | "engineering" | "bd" | "marketing" | "other";

type Candidate = {
  key: string;
  source: "tavily" | "github";
  name: string;
  title: string;
  github_url?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  avatar?: string | null;
  contributions?: number;
  confidence?: string;
  source_url?: string | null;
  bio?: string | null;
  role?: string;
  relevances: Relevance[];
  score: number;
};

type ViewFilter = "all" | "security" | "leadership" | "web3" | "engineering";

// Title → relevance tags + sort score. Security is intentionally weighted highest
// for this product's audience (a web3 security sales team).
function classifyTitle(title: string): { relevances: Relevance[]; score: number } {
  const t = (title || "").toLowerCase();
  const r: Relevance[] = [];
  let score = 0;

  if (/security|ciso|infosec|appsec|cybersec|trust\s*&?\s*safety|risk officer/.test(t)) {
    r.push("security");
    score += 50;
  }
  if (/web3|blockchain|crypto|defi|digital assets|tokenization|innovation|emerging tech|distributed ledger|\bdlt\b|fintech/.test(t)) {
    r.push("web3");
    score += 30;
  }
  if (/founder|co[- ]?founder|ceo|cto|cfo|coo|cmo|cso|chief|president|chairman|ciso/.test(t)) {
    r.push("leadership");
    score += 40;
  } else if (/\bvp\b|vice president|head of|director|svp|evp/.test(t)) {
    score += 25;
  } else if (/\blead\b|principal|senior|staff|tech lead|engineering manager/.test(t)) {
    score += 12;
  }
  if (/engineer|developer|architect|technical|swe\b|smart contract/.test(t)) {
    r.push("engineering");
    score += 5;
  }
  if (/\bbd\b|business dev|partnerships|growth|ecosystem|sales|alliances|\bgtm\b/.test(t)) {
    r.push("bd");
    score += 10;
  }
  if (/marketing|brand|communications|content|community|devrel|developer relations|press|pr lead/.test(t)) {
    r.push("marketing");
    score += 3;
  }
  if (r.length === 0) r.push("other");
  return { relevances: r, score };
}

// ============ GitHub source ============
type Contributor = { login: string; contributions: number; avatar_url: string; html_url: string };
type GithubUser = {
  login: string;
  name: string | null;
  bio: string | null;
  blog: string | null;
  twitter_username: string | null;
  company: string | null;
  avatar_url: string;
  html_url: string;
};
type SocialAccount = { provider: string; url: string };

async function ghJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.github.com${path}`, { headers: ghHeaders() });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function extractOwners(urls: string[]): string[] {
  const set = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      if (!/github\.com$/i.test(parsed.hostname)) continue;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0]) set.add(parts[0]);
    } catch {/* ignore */}
  }
  return Array.from(set).slice(0, 3);
}

async function verifyHandle(handle: string): Promise<boolean> {
  const r = await ghJson<{ login: string }>(`/users/${encodeURIComponent(handle)}`);
  return !!r?.login;
}

function classifySocial(s: SocialAccount): { linkedin?: string; telegram?: string; twitter?: string } {
  const url = s.url || "";
  const prov = (s.provider || "").toLowerCase();
  if (/linkedin\.com/i.test(url) || prov === "linkedin") return { linkedin: url };
  if (/t\.me\//i.test(url) || prov === "telegram") return { telegram: url };
  if (/(?:twitter|x)\.com/i.test(url) || prov === "twitter") return { twitter: url };
  return {};
}

function extractTelegram(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,})/i);
  return m ? `https://t.me/${m[1]}` : null;
}

async function fetchGithubCandidates(githubUrls: string[], companySlug: string): Promise<Candidate[]> {
  let owners = extractOwners(githubUrls);
  if (owners.length === 0) {
    const ok = await verifyHandle(companySlug.toLowerCase());
    if (ok) owners = [companySlug.toLowerCase()];
  }
  if (owners.length === 0) return [];

  const all = new Map<string, Contributor>();
  await Promise.all(
    owners.map(async (owner) => {
      const repos = await ghJson<Array<{ name: string; fork: boolean; archived: boolean }>>(
        `/users/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=20&type=public`,
      );
      if (!repos) return;
      const active = repos.filter((r) => !r.fork && !r.archived).slice(0, 5);
      await Promise.all(
        active.map(async (repo) => {
          const cs = await ghJson<Contributor[]>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}/contributors?per_page=15`,
          );
          if (!cs) return;
          for (const c of cs) {
            if (!c.login || /\[bot\]$/i.test(c.login)) continue;
            const existing = all.get(c.login);
            if (existing) existing.contributions += c.contributions;
            else all.set(c.login, { ...c });
          }
        }),
      );
    }),
  );

  const top = Array.from(all.values()).sort((a, b) => b.contributions - a.contributions).slice(0, 12);
  const enriched = await Promise.all(
    top.map(async (c) => {
      const [u, socials] = await Promise.all([
        ghJson<GithubUser>(`/users/${encodeURIComponent(c.login)}`),
        ghJson<SocialAccount[]>(`/users/${encodeURIComponent(c.login)}/social_accounts`),
      ]);
      const base = u || {
        login: c.login, name: null, bio: null, blog: null,
        twitter_username: null, company: null,
        avatar_url: c.avatar_url, html_url: c.html_url,
      };
      let linkedin: string | null = null;
      let telegram: string | null = null;
      let twitterUrl: string | null = base.twitter_username ? `https://x.com/${base.twitter_username}` : null;
      for (const s of socials || []) {
        const cls = classifySocial(s);
        if (cls.linkedin && !linkedin) linkedin = cls.linkedin;
        if (cls.telegram && !telegram) telegram = cls.telegram;
        if (cls.twitter && !twitterUrl) twitterUrl = cls.twitter;
      }
      const bioBlob = `${base.bio || ""} ${base.blog || ""}`;
      if (!telegram) telegram = extractTelegram(bioBlob);
      if (!linkedin) {
        const m = bioBlob.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
        if (m) linkedin = m[0];
      }

      let derivedTitle: string;
      if (base.company && base.company.trim()) {
        derivedTitle = `Engineer at ${base.company.trim().replace(/^@/, "")}`;
      } else if (base.bio) {
        const m = base.bio.match(/\b(co[- ]?founder|founder|cto|ceo|coo|cfo|chief|vp|head of|lead|director|architect|principal engineer|senior engineer)\b/i);
        derivedTitle = m ? m[0].replace(/\b\w/g, (s) => s.toUpperCase()) : "Engineering contributor";
      } else {
        derivedTitle = "Engineering contributor";
      }

      const { relevances, score: titleScore } = classifyTitle(derivedTitle);
      // Contributions bump for GitHub people so prolific engineers float up within tier.
      const score = titleScore + Math.min(15, Math.floor((c.contributions || 0) / 200));
      return {
        key: `github:${base.login}`,
        source: "github" as const,
        name: base.name || base.login,
        title: derivedTitle,
        github_url: base.html_url,
        linkedin,
        telegram,
        twitter: twitterUrl,
        avatar: base.avatar_url,
        contributions: c.contributions,
        bio: base.bio,
        role: "engineering",
        relevances,
        score,
      };
    }),
  );
  return enriched;
}

// ============ Tavily decision-makers source ============
type DecisionMakerResult = {
  candidates: Candidate[];
  diagnostics: { stage?: string; note?: string; tavilyDiagnostics?: unknown };
};

async function fetchDecisionMakers(args: {
  companySlug: string;
  companyName: string;
  companyUrl?: string | null;
  companyCategory?: string | null;
  isInstitution?: boolean | null;
}): Promise<DecisionMakerResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const base = import.meta.env.VITE_SUPABASE_URL || "https://qktjbtmcjrwzmtqnszbq.supabase.co";
  const r = await fetch(`${base}/functions/v1/find-decision-makers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      company_slug: args.companySlug,
      company_name: args.companyName,
      company_url: args.companyUrl,
      category: args.companyCategory,
      is_institution: !!args.isInstitution,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    let detail = data?.details ? ` — ${String(data.details).slice(0, 200)}` : "";
    if (!detail && Array.isArray(data?.tavily)) {
      const failed = (data.tavily as Array<{ ok: boolean; status?: number; error?: string }>).find((d) => !d.ok);
      if (failed) {
        const code = failed.status ? `${failed.status}` : "fail";
        const errText = (failed.error || "").trim();
        detail = ` — Tavily ${code}${errText ? `: ${errText.slice(0, 300)}` : ""}`;
      }
    }
    const stage = data?.stage ? ` (${data.stage})` : "";
    throw new Error(`${data?.error || "Tavily lookup failed"}${detail}${stage}`);
  }
  const raw = (data?.candidates || []) as Array<{
    name: string; title: string; linkedin: string | null; twitter: string | null;
    source_url: string | null; confidence: string;
  }>;
  const candidates: Candidate[] = raw.map((p, i) => {
    const { relevances, score: titleScore } = classifyTitle(p.title);
    const confidenceBoost = p.confidence === "high" ? 10 : p.confidence === "medium" ? 5 : 0;
    return {
      key: `tavily:${p.name.toLowerCase()}:${i}`,
      source: "tavily" as const,
      name: p.name,
      title: p.title || "Unknown",
      linkedin: p.linkedin,
      twitter: p.twitter,
      source_url: p.source_url,
      confidence: p.confidence,
      role: relevances.includes("leadership") ? "leadership" : "other",
      relevances,
      score: titleScore + confidenceBoost,
    };
  });
  return {
    candidates,
    diagnostics: { stage: data?.stage, note: data?.note, tavilyDiagnostics: data?.tavily },
  };
}

// ============ Match against already-saved people ============
type SavedKey = { byLinkedin: Set<string>; byGithub: Set<string>; byName: Set<string>; byTwitter: Set<string> };

function buildSavedKey(rows: Array<{ name: string | null; linkedin: string | null; github: string | null; twitter: string | null }>): SavedKey {
  const k: SavedKey = { byLinkedin: new Set(), byGithub: new Set(), byName: new Set(), byTwitter: new Set() };
  for (const r of rows) {
    if (r.linkedin) k.byLinkedin.add(r.linkedin.toLowerCase());
    if (r.github) k.byGithub.add(r.github.toLowerCase());
    if (r.twitter) k.byTwitter.add(r.twitter.toLowerCase());
    if (r.name) k.byName.add(r.name.trim().toLowerCase());
  }
  return k;
}

function isAlreadySaved(c: Candidate, saved: SavedKey): boolean {
  if (c.linkedin && saved.byLinkedin.has(c.linkedin.toLowerCase())) return true;
  if (c.github_url && saved.byGithub.has(c.github_url.toLowerCase())) return true;
  if (c.twitter && saved.byTwitter.has(c.twitter.toLowerCase())) return true;
  if (c.name && saved.byName.has(c.name.trim().toLowerCase())) return true;
  return false;
}

// ============ Component ============
export function FindPeopleDialog({
  open,
  onClose,
  companySlug,
  companyName,
  companyUrl,
  companyCategory,
  isInstitution,
  githubUrls,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const githubQ = useQuery({
    queryKey: ["find-people-github", companySlug, githubUrls.join(",")],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchGithubCandidates(githubUrls, companySlug),
  });

  const tavilyQ = useQuery({
    queryKey: ["find-people-tavily", companySlug, !!isInstitution],
    enabled: open && !!companyName,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchDecisionMakers({ companySlug, companyName, companyUrl, companyCategory, isInstitution }),
  });
  const tavilyCandidates = tavilyQ.data?.candidates || [];
  const tavilyNote = tavilyQ.data?.diagnostics?.note;

  const savedQ = useQuery({
    queryKey: ["dashboard-intel-people-keys", companySlug],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_people")
        .select("name,linkedin,github,twitter")
        .eq("company_slug", companySlug);
      if (error) throw error;
      return buildSavedKey((data || []) as Array<{ name: string | null; linkedin: string | null; github: string | null; twitter: string | null }>);
    },
  });

  const candidates = useMemo<Candidate[]>(() => {
    const all = [...tavilyCandidates, ...(githubQ.data || [])];
    // Sort by composite score (security weighted highest, then leadership, etc.)
    return all.sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [tavilyCandidates, githubQ.data]);

  const visible = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return candidates.filter((c) => {
      if (filter === "security" && !c.relevances.includes("security")) return false;
      if (filter === "leadership" && !c.relevances.includes("leadership")) return false;
      if (filter === "web3" && !c.relevances.includes("web3")) return false;
      if (filter === "engineering" && !c.relevances.includes("engineering")) return false;
      if (q) {
        const blob = `${c.name} ${c.title} ${c.bio || ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, filter, searchTerm]);

  // Counts per tag for the pill labels
  const tagCounts = useMemo(() => {
    const c = { security: 0, leadership: 0, web3: 0, engineering: 0 };
    for (const cand of candidates) {
      if (cand.relevances.includes("security")) c.security++;
      if (cand.relevances.includes("leadership")) c.leadership++;
      if (cand.relevances.includes("web3")) c.web3++;
      if (cand.relevances.includes("engineering")) c.engineering++;
    }
    return c;
  }, [candidates]);

  async function addPerson(c: Candidate) {
    if (!user) {
      toast.error("Sign in required");
      return;
    }
    setAdding((m) => ({ ...m, [c.key]: true }));
    try {
      const { error } = await supabase.from("company_people").insert({
        company_slug: companySlug,
        name: c.name,
        title: c.title || "Unknown",
        role: c.role || null,
        github: c.github_url || null,
        twitter: c.twitter || null,
        linkedin: c.linkedin || null,
        telegram: c.telegram || null,
        notes: c.bio || null,
        source: c.source,
        added_by: user.id,
      });
      if (error) throw error;
      toast.success(`Added ${c.name}`);
      setAddedKeys((s) => new Set(s).add(c.key));
      qc.invalidateQueries({ queryKey: ["dashboard-intel-people", companySlug] });
      qc.invalidateQueries({ queryKey: ["dashboard-intel-people-keys", companySlug] });
    } catch (e) {
      console.error("[add candidate]", e);
      const o = e as { message?: string; code?: string };
      const msg = e instanceof Error ? e.message : o?.message || JSON.stringify(e);
      toast.error(`Add failed: ${msg}`);
    } finally {
      setAdding((m) => ({ ...m, [c.key]: false }));
    }
  }

  if (!open) return null;

  const loading = githubQ.isLoading || tavilyQ.isLoading;
  const tavilyErr = tavilyQ.error ? (tavilyQ.error as Error).message : null;
  const ghErr = githubQ.error ? (githubQ.error as Error).message : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 lg:p-6 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-white/10 bg-[#0F1420] shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Find people"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-white">Find people at {companyName}</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Searching X & web for leadership, plus GitHub for engineering.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-white p-1 rounded-md hover:bg-white/[0.04]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-white/[0.06] flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by name or title…"
              className="as-input pl-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap bg-white/[0.04] rounded-md p-0.5">
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
              All <span className="opacity-50">{candidates.length}</span>
            </FilterPill>
            <FilterPill active={filter === "security"} onClick={() => setFilter("security")}>
              <Shield className="w-3 h-3" /> Security <span className="opacity-50">{tagCounts.security}</span>
            </FilterPill>
            <FilterPill active={filter === "leadership"} onClick={() => setFilter("leadership")}>
              <Crown className="w-3 h-3" /> Leadership <span className="opacity-50">{tagCounts.leadership}</span>
            </FilterPill>
            <FilterPill active={filter === "web3"} onClick={() => setFilter("web3")}>
              <Sprout className="w-3 h-3" /> Web3 <span className="opacity-50">{tagCounts.web3}</span>
            </FilterPill>
            <FilterPill active={filter === "engineering"} onClick={() => setFilter("engineering")}>
              <Code className="w-3 h-3" /> Engineering <span className="opacity-50">{tagCounts.engineering}</span>
            </FilterPill>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && candidates.length === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 bg-white/[0.03] rounded-md animate-pulse" />
              ))}
            </div>
          )}

          {tavilyErr && (
            <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30 rounded-md px-3 py-2">
              Leadership search failed: {tavilyErr}
            </div>
          )}
          {!tavilyErr && !tavilyQ.isLoading && tavilyCandidates.length === 0 && (
            <div className="text-xs text-muted-foreground bg-white/[0.02] border border-white/[0.04] rounded-md px-3 py-2">
              Leadership search returned no candidates{tavilyNote ? ` — ${tavilyNote}` : ""}.
            </div>
          )}
          {ghErr && (
            <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30 rounded-md px-3 py-2">
              Engineering search: {ghErr}
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-10">
              No candidates {searchTerm ? "match that filter" : "found"}.
            </div>
          )}

          <ul className="space-y-2">
            {visible.map((c) => {
              const already = savedQ.data ? isAlreadySaved(c, savedQ.data) : false;
              const isAdded = addedKeys.has(c.key) || already;
              const isAdding = !!adding[c.key];
              return (
                <li
                  key={c.key}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
                    isAdded ? "bg-white/[0.02] border-white/[0.04] opacity-60" : "bg-white/[0.03] border-white/[0.06]"
                  }`}
                >
                  {c.avatar ? (
                    <img
                      src={c.avatar}
                      alt=""
                      className="w-9 h-9 rounded-full bg-white/5 shrink-0 object-cover"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0">
                      {(c.name[0] || "?").toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                      <SourcePill source={c.source} confidence={c.confidence} contributions={c.contributions} />
                      <RelevanceTags relevances={c.relevances} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{c.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {c.linkedin && (
                        <a
                          href={c.linkedin}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300"
                          title="LinkedIn"
                        >
                          <Linkedin className="w-3 h-3" />
                        </a>
                      )}
                      {c.twitter && (
                        <a
                          href={c.twitter}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary text-[10px] font-semibold"
                          title="X"
                        >
                          𝕏
                        </a>
                      )}
                      {c.telegram && (
                        <a
                          href={c.telegram}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 hover:text-cyan-200"
                          title="Telegram"
                        >
                          <TelegramIcon className="w-3 h-3" />
                        </a>
                      )}
                      {c.github_url && (
                        <a
                          href={c.github_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title="GitHub"
                        >
                          <Github className="w-3 h-3" />
                        </a>
                      )}
                      {c.source_url && (
                        <a
                          href={c.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title="Source"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addPerson(c)}
                    disabled={isAdded || isAdding}
                    className={`shrink-0 text-[11px] inline-flex items-center gap-1 px-2 py-1.5 rounded-md border transition-colors ${
                      isAdded
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-default"
                        : "bg-white/[0.03] text-muted-foreground border-white/10 hover:text-primary hover:border-white/20 disabled:opacity-50"
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-3 h-3" /> {already && !addedKeys.has(c.key) ? "Saved" : "Added"}
                      </>
                    ) : isAdding ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-3 h-3" /> Add
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {loading && candidates.length > 0 && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5 pl-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Still loading more sources…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>
            {visible.length} candidate{visible.length === 1 ? "" : "s"}
            {candidates.length !== visible.length ? ` of ${candidates.length}` : ""}
          </span>
          <span>
            <Sparkles className="w-3 h-3 inline" /> Tavily + GitHub
          </span>
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

const TAG_STYLES: Record<Relevance, { cls: string; label: string; icon: React.ReactNode }> = {
  security: { cls: "bg-red-500/10 text-red-300 border-red-500/30", label: "Security", icon: <Shield className="w-2.5 h-2.5" /> },
  leadership: { cls: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "Leadership", icon: <Crown className="w-2.5 h-2.5" /> },
  web3: { cls: "bg-violet-500/10 text-violet-300 border-violet-500/30", label: "Web3", icon: <Sprout className="w-2.5 h-2.5" /> },
  engineering: { cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30", label: "Eng", icon: <Code className="w-2.5 h-2.5" /> },
  bd: { cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "BD", icon: <Briefcase className="w-2.5 h-2.5" /> },
  marketing: { cls: "bg-pink-500/10 text-pink-300 border-pink-500/30", label: "Mkt", icon: null },
  other: { cls: "bg-white/[0.04] text-muted-foreground border-white/10", label: "Other", icon: null },
};

function RelevanceTags({ relevances }: { relevances: Relevance[] }) {
  // Show up to 3 most useful tags; hide "other" if anything else is present.
  const filtered = relevances.filter((r) => r !== "other");
  const list = (filtered.length === 0 ? relevances : filtered).slice(0, 3);
  return (
    <>
      {list.map((r) => {
        const s = TAG_STYLES[r];
        return (
          <span key={r} className={`text-[9px] px-1.5 py-0.5 rounded-md border inline-flex items-center gap-0.5 ${s.cls}`}>
            {s.icon}
            {s.label}
          </span>
        );
      })}
    </>
  );
}

function SourcePill({
  source,
  confidence,
  contributions,
}: {
  source: "tavily" | "github";
  confidence?: string;
  contributions?: number;
}) {
  if (source === "tavily") {
    const cls =
      confidence === "high"
        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
        : confidence === "low"
          ? "bg-muted/10 text-muted-foreground border-white/10"
          : "bg-amber-500/10 text-amber-300 border-amber-500/30";
    return (
      <span className={`text-[9px] px-1.5 py-0.5 rounded-md border inline-flex items-center gap-0.5 ${cls}`}>
        <Crown className="w-2.5 h-2.5" />
        {confidence || "medium"}
      </span>
    );
  }
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-md border bg-white/[0.04] text-muted-foreground border-white/10 inline-flex items-center gap-0.5">
      <Github className="w-2.5 h-2.5" />
      {contributions ? `${contributions.toLocaleString()} commits` : "GitHub"}
    </span>
  );
}
