import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import NotFound from "@/pages/NotFound";
import { AppLayout } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";

// Admin pages render a plain 404 for anyone who isn't on the server-side
// allowlist (signed out included), so the route doesn't reveal it exists.
export function AdminRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const adminQ = useIsAdmin();
  if (loading || (session && adminQ.isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }
  if (!session || adminQ.data !== true) return <NotFound />;
  return (
    <AppLayout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppLayout>
  );
}
