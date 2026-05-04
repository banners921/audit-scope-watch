const LANG_COLORS: Record<string, string> = {
  solidity: "#3B82F6",
  rust: "#F97316",
  move: "#8B5CF6",
  cairo: "#14B8A6",
  go: "#06B6D4",
  vyper: "#10B981",
};

export function LangBadge({ language, className = "" }: { language: string | null | undefined; className?: string }) {
  if (!language) return null;
  const key = language.toLowerCase();
  const color = LANG_COLORS[key] || "#6B7280";
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-md font-medium border ${className}`}
      style={{ backgroundColor: `${color}1A`, color, borderColor: `${color}40` }}
    >
      {language}
    </span>
  );
}

export function ActiveDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="relative inline-flex w-2 h-2 shrink-0" title="Actively shipping code" aria-label="Actively shipping code">
      <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ backgroundColor: "#10B981" }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "#10B981" }} />
    </span>
  );
}
