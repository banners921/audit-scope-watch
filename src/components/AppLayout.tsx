import { ReactNode, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, Building2, Database, Bell, User as UserIcon, LogOut, Menu, Wallet } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/funds", label: "Funds", icon: Wallet },
  { to: "/protocols", label: "Protocols", icon: Database },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

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

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/protocols/")
      ? "Protocol Detail"
      : pathname.startsWith("/companies/")
      ? "Company Detail"
      : pathname.startsWith("/funds/")
      ? "Fund Detail"
      : "AuditScope");

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-surface border-r border-white/[0.06] transform transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <Logo size={28} />
        </div>
        <nav className="p-3 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors border-l-2 ${
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent text-muted-foreground hover:text-white hover:bg-white/[0.03]"
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
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
