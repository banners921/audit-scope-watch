import { NavLink } from "react-router-dom";
import { ShieldCheck, Newspaper, TrendingUp, Calendar, ArrowLeft } from "lucide-react";

const TABS = [
  { to: "/book/security", icon: ShieldCheck, label: "Security" },
  { to: "/book/news", icon: Newspaper, label: "News" },
  { to: "/book/growth", icon: TrendingUp, label: "Growth" },
  { to: "/book/calendar", icon: Calendar, label: "Calendar" },
] as const;

export function BookTabs() {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <NavLink
        to="/brief"
        className="text-[11px] px-2.5 py-1.5 rounded border border-white/[0.08] text-muted-foreground hover:text-white hover:border-primary/40 hover:bg-white/[0.03] inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3 h-3" /> Home
      </NavLink>
      <span className="w-px h-4 bg-white/10" />
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `text-[11px] px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors border ${
              isActive
                ? "border-primary/40 bg-primary/10 text-primary font-medium"
                : "border-white/[0.08] text-muted-foreground hover:text-white hover:border-primary/40 hover:bg-white/[0.03]"
            }`
          }
        >
          <t.icon className="w-3.5 h-3.5" />
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
