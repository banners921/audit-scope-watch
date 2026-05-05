import { ReactNode, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, Building2, Database, Bell, User as UserIcon, LogOut, Menu, Wallet, Sparkles, ChevronDown } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "@/hooks/useAuth";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/companies": "Companies",
  "/funds": "Funds",
  "/protocols": "Protocol Database",
  "/alerts": "Alert Configuration",
  "/profile": "Profile",
};

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(true);

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/protocols/")
      ? "Protocol Detail"
      : pathname.startsWith("/companies/")
      ? "Company Detail"
      : pathname.startsWith("/funds/")
      ? "Fund Detail"
      : "AuditScope");

  const topItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg transition-colors border-l-2 px-3 py-2.5 text-sm ${
      isActive
        ? "border-primary bg-primary/5 text-primary"
        : "border-transparent text-muted-foreground hover:text-white hover:bg-white/[0.03]"
    }`;

  const subItemClass = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-2 rounded-lg transition-colors pr-3 py-1.5 text-xs ml-4 pl-3 border-l-2 ${
      isActive
        ? "border-primary text-primary bg-primary/5"
        : "border-transparent text-muted-foreground/70 hover:text-white hover:bg-white/[0.03]"
    }`;

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-surface border-r border-white/[0.06] transform transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <Logo size={28} />
        </div>
        <nav className="p-3 space-y-1">
          <NavLink to="/dashboard" onClick={() => setMobileOpen(false)} className={topItemClass}>
            <LayoutGrid className="w-4 h-4" />
            <span className="font-medium">Dashboard</span>
          </NavLink>

          <button
            type="button"
            onClick={() => setIntelOpen((v) => !v)}
            className="w-full flex items-center gap-3 rounded-lg transition-colors border-l-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-white hover:bg-white/[0.03]"
            aria-expanded={intelOpen}
          >
            <Sparkles className="w-4 h-4" />
            <span className="font-medium flex-1 text-left">Intelligence</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${intelOpen ? "rotate-0" : "-rotate-90"}`}
            />
          </button>

          <div
            className={`grid transition-all duration-200 ease-out ${
              intelOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden space-y-1">
              <NavLink to="/companies" onClick={() => setMobileOpen(false)} className={subItemClass}>
                <Building2 className="w-3.5 h-3.5" />
                <span className="font-medium">Companies</span>
              </NavLink>
              <NavLink to="/protocols" onClick={() => setMobileOpen(false)} className={subItemClass}>
                <Database className="w-3.5 h-3.5" />
                <span className="font-medium">Protocols</span>
              </NavLink>
            </div>
          </div>

          <NavLink to="/funds" onClick={() => setMobileOpen(false)} className={topItemClass}>
            <Wallet className="w-4 h-4" />
            <span className="font-medium">Funds</span>
          </NavLink>
          <NavLink to="/alerts" onClick={() => setMobileOpen(false)} className={topItemClass}>
            <Bell className="w-4 h-4" />
            <span className="font-medium">Alerts</span>
          </NavLink>
          <NavLink to="/profile" onClick={() => setMobileOpen(false)} className={topItemClass}>
            <UserIcon className="w-4 h-4" />
            <span className="font-medium">Profile</span>
          </NavLink>
        </nav>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-white/[0.06] bg-surface/50 backdrop-blur flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-muted-foreground"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-white tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
              {user?.email}
            </span>
            <button
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              className="text-muted-foreground hover:text-destructive transition-colors p-2 rounded-md hover:bg-white/[0.03]"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
