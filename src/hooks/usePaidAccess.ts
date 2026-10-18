import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

// Whether the signed-in user can read the data: an active paid
// subscription (plan_tier 'pro', set by stripe-webhook) or an admin. The same
// has_paid_access() check gates every data table in the database, so this only
// decides what to render — it is not the security boundary.
export function usePaidAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["paid-access", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_paid_access");
      if (error) throw error;
      return data === true;
    },
  });
}
