import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export type CardFactTone = "good" | "warn" | "bad" | "primary" | "muted";

export interface CardFact {
  label: string;
  value: ReactNode;
  tone?: CardFactTone;
  icon?: ReactNode;
}

export interface CardBadge {
  label: string;
  tone?: "primary" | "success" | "warn" | "danger" | "neutral";
}

export interface CardCta {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  variant?: "primary" | "ghost" | "danger" | "success";
}

interface EntityCardProps {
  href?: string;                  // makes the whole card a link
  logoUrl?: string | null;        // company / fund logo
  icon?: ReactNode;               // fallback icon if no logo
  eyebrow?: string;               // small label above title
  title: string;
  subtitle?: string;              // 1-line tagline
  fitLine?: ReactNode;            // narrative blurb ("Last audit 4mo ago by Trail of Bits...")
  facts?: CardFact[];             // structured fact pills below blurb
  badges?: CardBadge[];           // status badges
  primaryCta?: CardCta;
  secondaryCta?: CardCta;
  tertiaryCta?: CardCta;
  size?: "sm" | "md" | "lg";      // sm = grid item, md = list row, lg = hero/stack
  className?: string;
  rightMeta?: ReactNode;          // anything pinned to the upper right (e.g. timestamp)
}

const toneClass: Record<CardFactTone, string> = {
  good: "text-emerald-400",
  warn: "text-amber-300",
  bad: "text-rose-400",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

const badgeToneClass: Record<NonNullable<CardBadge["tone"]>, string> = {
  primary: "bg-primary/15 text-primary border-primary/30",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  danger: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  neutral: "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
};

const ctaVariantClass: Record<NonNullable<CardCta["variant"]>, string> = {
  primary: "bg-primary text-primary-foreground hover:brightness-110",
  ghost: "border border-white/[0.08] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
  danger: "border border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.1]",
  success: "border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/[0.1]",
};

export function EntityCard({
  href,
  logoUrl,
  icon,
  eyebrow,
  title,
  subtitle,
  fitLine,
  facts = [],
  badges = [],
  primaryCta,
  secondaryCta,
  tertiaryCta,
  size = "md",
  className = "",
  rightMeta,
}: EntityCardProps) {
  const sizeCls = size === "lg" ? "p-6 gap-4" : size === "sm" ? "p-3 gap-2" : "p-4 gap-3";
  const titleCls = size === "lg" ? "text-xl" : size === "sm" ? "text-[13px]" : "text-[15px]";
  const logoBox = size === "lg" ? "w-12 h-12" : size === "sm" ? "w-7 h-7" : "w-9 h-9";

  const inner = (
    <div className={`as-card flex flex-col ${sizeCls} hover:border-primary/30 transition-colors group ${className}`}>
      {/* Header row: logo + title + right meta */}
      <div className="flex items-start gap-3">
        <div className={`${logoBox} shrink-0 rounded-lg overflow-hidden bg-white/[0.04] flex items-center justify-center`}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <span className="text-muted-foreground">{icon ?? defaultIcon(title)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-primary mb-0.5">{eyebrow}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`${titleCls} font-semibold text-foreground truncate`}>{title}</div>
            {badges.map((b, i) => (
              <span key={i} className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeToneClass[b.tone ?? "neutral"]}`}>{b.label}</span>
            ))}
          </div>
          {subtitle && <div className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{subtitle}</div>}
        </div>
        {rightMeta && <div className="shrink-0 text-[10.5px] text-muted-foreground font-mono">{rightMeta}</div>}
      </div>

      {/* Fit-line narrative */}
      {fitLine && (
        <div className="text-[12px] text-foreground/85 leading-relaxed">
          {fitLine}
        </div>
      )}

      {/* Facts strip */}
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px]">
          {facts.map((f, i) => (
            <div key={i} className="inline-flex items-center gap-1.5">
              {f.icon && <span className="text-muted-foreground">{f.icon}</span>}
              <span className="text-muted-foreground">{f.label}</span>
              <span className={`font-semibold ${toneClass[f.tone ?? "muted"]} tabular-nums`}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTAs */}
      {(primaryCta || secondaryCta || tertiaryCta) && (
        <div className="flex items-center gap-2 pt-1">
          {primaryCta && renderCta(primaryCta, "primary")}
          {secondaryCta && renderCta(secondaryCta, secondaryCta.variant ?? "ghost")}
          {tertiaryCta && renderCta(tertiaryCta, tertiaryCta.variant ?? "ghost")}
        </div>
      )}
    </div>
  );

  if (href && !primaryCta && !secondaryCta && !tertiaryCta) {
    return <Link to={href} className="block">{inner}</Link>;
  }
  return inner;
}

function renderCta(cta: CardCta, variant: NonNullable<CardCta["variant"]>) {
  const cls = `inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${ctaVariantClass[variant]}`;
  const content = (
    <>
      {cta.icon}
      <span>{cta.label}</span>
    </>
  );
  if (cta.href) {
    return <Link to={cta.href} className={cls}>{content}<ArrowRight className="w-3 h-3 opacity-60" /></Link>;
  }
  return (
    <button type="button" onClick={cta.onClick} className={cls}>
      {content}
    </button>
  );
}

function defaultIcon(name: string) {
  return <span className="text-[12px] font-bold opacity-60">{name?.[0]?.toUpperCase() ?? "?"}</span>;
}
