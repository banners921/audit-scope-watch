import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "./AppLayout";

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
  return <AppLayout>{children}</AppLayout>;
}
