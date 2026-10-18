import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

const linkCls = "inline-flex items-center min-h-[44px] px-1 hover:text-foreground rounded";

export function SiteFooter() {
  return (
    <footer className="border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
      <div className="max-w-[1100px] mx-auto px-4 lg:px-6 py-8 flex flex-col md:flex-row md:items-center justify-between gap-4 text-[12.5px] text-muted-foreground">
        <div className="space-y-2">
          <Logo size={18} />
          <p>Security audit data for crypto projects. © {new Date().getFullYear()} AuditScope.ai</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4">
          <Link to="/pricing" className={linkCls}>Pricing</Link>
          <Link to="/docs" className={linkCls}>API docs</Link>
          <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className={linkCls}>Contact (Telegram)</a>
          <Link to="/login" className={linkCls}>Sign in</Link>
          <Link to="/signup" className={linkCls}>Create free account</Link>
        </nav>
      </div>
    </footer>
  );
}
