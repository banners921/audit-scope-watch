import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Bell,
  BellRing,
  User as UserIcon,
  LogOut,
  Menu,
  Wallet,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Award,
  Banknote,
  Home,
  Star,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

const COLLAPSED_KEY = "as_sidebar_collapsed";

const TITLES: Record<string, string> = {
  "/dashboard": "Home",
  "/watchlist": "Watchlist",
  "/funds": "Funds",
  "/funding-rounds": "Funding rounds",
  "/companies": "Companies",
  "/audit-reports": "Audits",
  "/auditors": "Auditors",
  "/audit-firms": "Audits",
  "/profile": "My Profile",
  "/account": "My Profile",
  "/reminders": "Reminders",
};

const NAV = [
  { to: "/dashboard", label: "Home", icon: Home },
  { to: "/audit-reports", label: "Audits", icon: ShieldCheck },
  { to: "/auditors", label: "Auditors", icon: Award },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/funding-rounds", label: "Funding rounds", icon: Banknote },
  { to: "/funds", label: "Funds", icon: Wallet },
  { to: "/watchlist", label: "Watchlist", icon: Star },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("is_admin").eq("user_id", user!.id).maybeSingle();
      return !!data?.is_admin;
    },
  });

  const dueCount = useQuery({
    queryKey: ["reminders-due-count", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("reminders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .lte("remind_at", new Date().toISOString());
      if (error) return 0;
      return count ?? 0;
    },
  });

  const watchlistCount = useQuery({
    queryKey: ["watchlist-count", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("target_actions")
        .select("company_slug", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("action", "watched");
      return count ?? 0;
    },
  });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const title =
    TITLES[pathname] ||
    (pathname.startsWith("/protocol/") || pathname.startsWith("/companies/")
      ? "Company"
      : pathname.startsWith("/funds/")
      ? "Fund"
      : pathname.startsWith("/auditors/")
      ? "Audit firm"
      : "AuditScope");

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg transition-colors border-l-2 ${
      collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
    } text-sm ${
      isActive
        ? "border-primary bg-primary/5 text-primary"
        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
    }`;

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 bg-surface border-r transform transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
        style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}
      >
        <div className={`flex items-center justify-between border-b ${collapsed ? "px-2 py-5" : "px-5 py-5"}`} style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
          {!collapsed && <Logo size={28} />}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-white/[0.04]"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className="p-3 space-y-1 mt-2">
          {NAV.map((n) => {
            const Icon = n.icon;
            const isWatch = n.to === "/watchlist";
            const watchN = watchlistCount.data ?? 0;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setMobileOpen(false)}
                className={itemClass}
                title={collapsed ? n.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && (
                  <span className="font-medium flex-1 flex items-center justify-between">
                    {n.label}
                    {isWatch && watchN > 0 && (
                      <span className="text-[10px] font-mono text-primary tabular-nums">{watchN}</span>
                    )}
                  </span>
                )}
              </NavLink>
            );
          })}

          <div className="pt-3 mt-3 border-t space-y-1" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
            <NavLink to="/reminders" onClick={() => setMobileOpen(false)} className={itemClass} title={collapsed ? "Reminders" : undefined}>
              <span className="relative inline-flex shrink-0">
                {(dueCount.data ?? 0) > 0 ? <BellRing className="w-4 h-4 text-amber-300" /> : <Bell className="w-4 h-4" />}
                {(dueCount.data ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center px-0.5">
                    {dueCount.data}
                  </span>
                )}
              </span>
              {!collapsed && <span className="font-medium flex-1">Reminders</span>}
            </NavLink>
            <NavLink to="/account" onClick={() => setMobileOpen(false)} className={itemClass} title={collapsed ? "My Profile" : undefined}>
              <UserIcon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="font-medium">My Profile</span>}
            </NavLink>
            {isAdminQ.data && (
              <NavLink to="/admin" onClick={() => setMobileOpen(false)} className={itemClass} title={collapsed ? "Admin" : undefined}>
                <ShieldCheck className="w-4 h-4 shrink-0 text-primary" />
                {!collapsed && <span className="font-medium text-primary">Admin</span>}
              </NavLink>
            )}
          </div>
        </nav>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="h-14 border-b bg-surface/60 backdrop-blur flex items-center justify-between px-4 lg:px-6"
          style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}
        >
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-muted-foreground"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden md:inline text-xs text-muted-foreground font-mono">{user?.email}</span>
            <button
              onClick={async () => { await signOut(); navigate("/login"); }}
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
