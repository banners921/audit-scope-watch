import { Navigate } from "react-router-dom";
import { useViewMode } from "@/hooks/useViewMode";

/** Routes / and post-login traffic to the unified dashboard.
 *  Fresh accounts (no profile-derived mode) → /onboarding. */
export default function HomeRedirect() {
  const { resolved, profileMode } = useViewMode();
  if (!resolved) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!profileMode) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
