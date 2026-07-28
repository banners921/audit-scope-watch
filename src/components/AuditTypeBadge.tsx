import { FileCode2, Trophy, RefreshCw, Scale, Vote, ShieldAlert, Compass, Coins, FileCheck } from "lucide-react";

type AuditTypeMeta = {
  icon: typeof FileCode2;
  short: string;       // 3-char compact label
  label: string;       // full label
  tooltip: string;     // explanation
  cls: string;         // pill color classes
};

const TYPE_MAP: Record<string, AuditTypeMeta> = {
  smart_contract_audit: {
    icon: FileCode2,
    short: "SCA",
    label: "Smart Contract Audit",
    tooltip: "Full review of smart-contract source code for vulnerabilities.",
    cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  },
  contest: {
    icon: Trophy,
    short: "Contest",
    label: "Audit Contest",
    tooltip: "Public competitive audit (Code4rena, Sherlock, Cantina). Many wardens, fixed prize pool.",
    cls: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
  fix_review: {
    icon: RefreshCw,
    short: "Fix Review",
    label: "Fix Review",
    tooltip: "Re-audit verifying mitigations applied after the initial audit's findings.",
    cls: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  },
  proof_of_reserves: {
    icon: Scale,
    short: "PoR",
    label: "Proof of Reserves",
    tooltip: "Financial attestation — on-chain reserves vs off-chain liabilities. NOT a code audit.",
    cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  governance_review: {
    icon: Vote,
    short: "Gov",
    label: "Governance Review",
    tooltip: "Audit of multisig configuration, governance flow, timelock setup.",
    cls: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  },
  pentest: {
    icon: ShieldAlert,
    short: "Pentest",
    label: "Penetration Test",
    tooltip: "Pentest of web app / API surfaces — different from smart-contract code audit.",
    cls: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  },
  design_review: {
    icon: Compass,
    short: "Design",
    label: "Design Review",
    tooltip: "Pre-implementation review of architecture, threat model, or mechanism design.",
    cls: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  },
  token_audit: {
    icon: Coins,
    short: "Token",
    label: "Token Audit",
    tooltip: "Light ERC20/SPL sanity scan — typically narrower scope than full SCA.",
    cls: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  },
  letter_of_attestation: {
    icon: FileCheck,
    short: "Letter",
    label: "Letter of Attestation",
    tooltip: "Formal letter confirming an audit happened — abbreviated summary, no detailed findings.",
    cls: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  },
};

const UNKNOWN: AuditTypeMeta = {
  icon: FileCode2,
  short: "Audit",
  label: "Audit",
  tooltip: "Audit type not classified.",
  cls: "bg-white/[0.05] text-white/70 border-white/10",
};

export function auditTypeMeta(t: string | null | undefined): AuditTypeMeta {
  if (!t) return UNKNOWN;
  return TYPE_MAP[t] || UNKNOWN;
}

type Props = {
  type: string | null | undefined;
  variant?: "compact" | "normal";
  className?: string;
};

export function AuditTypeBadge({ type, variant = "normal", className = "" }: Props) {
  const meta = auditTypeMeta(type);
  const Icon = meta.icon;
  if (variant === "compact") {
    return (
      <span
        title={`${meta.label} — ${meta.tooltip}`}
        className={`inline-flex items-center justify-center w-5 h-5 rounded border ${meta.cls} ${className}`}
      >
        <Icon className="w-3 h-3" />
      </span>
    );
  }
  return (
    <span
      title={meta.tooltip}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.cls} ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span>{meta.short}</span>
    </span>
  );
}
