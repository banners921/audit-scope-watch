import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Globe, Twitter, Linkedin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeTwitterUrl } from "@/lib/format";

type Fund = {
  slug: string;
  name: string;
  website: string | null;
  twitter: string | null;
  linkedin: string | null;
  investment_count: number | null;
  rounds_led: string | null;
  secondary_investments: string | null;
  portfolio_companies: string | null;
};

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function FundDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();

  const fund = useQuery({
    queryKey: ["fund", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("funds").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data as Fund | null;
    },
  });

  const portfolio = parseList(fund.data?.portfolio_companies ?? null);
  const portfolioSlugs = portfolio.map(slugify);

  const existingCompanies = useQuery({
    queryKey: ["fund-portfolio-companies", portfolioSlugs.join(",")],
    enabled: portfolioSlugs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug")
        .in("slug", portfolioSlugs);
      if (error) throw error;
      return new Set((data || []).map((r: { slug: string }) => r.slug));
    },
  });

  if (fund.isLoading) return <div className="text-muted-foreground">Loading fund…</div>;
  if (!fund.data) return <div className="text-muted-foreground">Fund not found.</div>;

  const f = fund.data;
  const tw = normalizeTwitterUrl(f.twitter);
  const rounds = parseList(f.rounds_led);
  const existing = existingCompanies.data || new Set<string>();

  return (
    <div className="space-y-6 max-w-[1400px]">
      <button
        onClick={() => navigate(-1)}
        className="text-muted-foreground hover:text-white text-sm flex items-center gap-1.5"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="as-card p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{f.name}</h2>
            <div className="flex items-center gap-3 mt-3">
              {f.website && <a href={f.website} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="w-4 h-4" /></a>}
              {tw && <a href={tw} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Twitter className="w-4 h-4" /></a>}
              {f.linkedin && <a href={f.linkedin} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Linkedin className="w-4 h-4" /></a>}
            </div>
          </div>
          <div className="text-sm px-3 py-2 rounded-md bg-primary/10 text-primary border border-primary/20 font-mono">
            {f.investment_count ?? 0} investments
          </div>
        </div>
      </div>

      <div className="as-card p-6">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Led Investments</h3>
        {rounds.length === 0 ? (
          <p className="text-muted-foreground text-sm">No led rounds recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {rounds.map((r, i) => (
              <span key={`${r}-${i}`} className="text-xs px-2.5 py-1 rounded-md bg-white/[0.04] text-muted-foreground border border-white/10">
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="as-card p-6">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Portfolio Companies</h3>
        {portfolio.length === 0 ? (
          <p className="text-muted-foreground text-sm">No portfolio companies recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {portfolio.map((name, i) => {
              const s = slugify(name);
              const isLinked = existing.has(s);
              const cls = "text-xs px-2.5 py-1 rounded-md border";
              return isLinked ? (
                <Link
                  key={`${name}-${i}`}
                  to={`/companies/${s}`}
                  className={`${cls} bg-primary/10 text-primary border-primary/20 hover:bg-primary/20`}
                >
                  {name}
                </Link>
              ) : (
                <span key={`${name}-${i}`} className={`${cls} bg-white/[0.04] text-muted-foreground border-white/10`}>
                  {name}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
