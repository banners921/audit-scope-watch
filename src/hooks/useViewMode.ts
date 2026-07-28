import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export type ViewMode = "fund" | "auditor" | "tooling";

const VALID_MODES = new Set<ViewMode>(["fund", "auditor", "tooling"]);

export function useViewMode(): {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  resolved: boolean;
  profileMode: ViewMode | null;
} {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQ = useQuery({
    queryKey: ["vm-profile", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ViewMode | null> => {
      const { data } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", user!.id)
        .maybeSingle();
      const role = (data?.role ?? null) as string | null;
      return role && VALID_MODES.has(role as ViewMode) ? (role as ViewMode) : null;
    },
  });

  const setModeMut = useMutation({
    mutationFn: async (m: ViewMode) => {
      if (!user) return;
      const { error } = await supabase
        .from("user_profiles")
        .upsert(
          { user_id: user.id, role: m, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vm-profile", user?.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-profile-min", user?.id] });
    },
  });

  const profileMode = profileQ.data ?? null;
  const mode: ViewMode = profileMode ?? "fund";
  const resolved = !user || !profileQ.isLoading;

  return { mode, setMode: setModeMut.mutate, resolved, profileMode };
}
