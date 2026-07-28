import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export function useFundSlug() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["book-profile-fund", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user!.id).maybeSingle();
      return (data?.fund_slug ?? null) as string | null;
    },
  });
  return q.data ?? null;
}

export function usePortfolioSlugs(fundSlug: string | null) {
  return useQuery({
    queryKey: ["book-portfolio-slugs", fundSlug],
    enabled: !!fundSlug,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("fund_portfolio").select("company_slug").eq("fund_slug", fundSlug!);
      return Array.from(new Set((data ?? []).map((r: any) => r.company_slug as string).filter(Boolean)));
    },
  });
}

export function usePortfolioCompanies(slugs: string[]) {
  return useQuery({
    queryKey: ["book-portfolio-companies", slugs.length, slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,url,logo,category,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm,description")
        .in("slug", slugs);
      const m = new Map<string, any>();
      for (const c of (data ?? []) as any[]) m.set(c.slug, c);
      return m;
    },
  });
}
