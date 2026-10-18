import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";

// Shared top bar for the public pages (home, pricing, docs).
export function SiteNav({ current }: { current?: "pricing" | "docs" }) {
  const { user } = useAuth();
  const link = (to: string, label: string, key?: string) => (
    <Link
      to={to}
      aria-current={current === key ? "page" : undefined}
      className={`hidden sm:inline-flex items-center min-h-[44px] px-3 text-[13px] rounded-md hover:text-foreground ${current === key ? "text-foreground" : "text-muted-foreground"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-background/80 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
      <nav aria-label="Main" className="max-w-[1100px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-2">
        <Link to="/" aria-label="AuditScope home" className="inline-flex items-center min-h-[44px] rounded-md"><Logo size={22} /></Link>
        <div className="flex items-center gap-1">
          {link("/pricing", "Pricing", "pricing")}
          {link("/docs", "API docs", "docs")}
          {user ? (
            <Link to="/radar" className="inline-flex items-center gap-1 min-h-[44px] px-3.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
              Open app <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          ) : (
            <>
              <Link to="/login" className="inline-flex items-center min-h-[44px] px-3 text-[13px] text-muted-foreground hover:text-foreground rounded-md">Sign in</Link>
              <Link to="/signup" className="inline-flex items-center gap-1 min-h-[44px] px-3.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
                Get started <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
