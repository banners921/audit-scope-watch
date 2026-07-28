import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  // ErrorBoundary inside AppLayout — page crashes show the error UI but the
  // sidebar + header stay rendered so the user can still navigate.
  return (
    <AppLayout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppLayout>
  );
}
