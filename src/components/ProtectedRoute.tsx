import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePaidAccess } from "@/hooks/usePaidAccess";
import { AppLayout } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";
import { Paywall } from "./Paywall";

// allowUnpaid: pages a signed-in user needs before subscribing (account,
// profile, onboarding). Everything else shows the paywall until they pay; the
// database enforces the same rule, so this is presentation, not security.
export function ProtectedRoute({ children, allowUnpaid = false }: { children: ReactNode; allowUnpaid?: boolean }) {
  const { session, loading } = useAuth();
  const paidQ = usePaidAccess();
  const checkingPaid = !allowUnpaid && !!session && paidQ.isLoading;
  if (loading || checkingPaid) {
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
      <ErrorBoundary>{allowUnpaid || paidQ.data === true ? children : <Paywall />}</ErrorBoundary>
    </AppLayout>
  );
}
