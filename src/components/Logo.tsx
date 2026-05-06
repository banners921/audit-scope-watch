export function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  // Visual icon is rendered larger than the layout `size`, matching the landing
  // page where the wordmark sits flush against the icon.
  const iconSize = Math.round(size * 1.8);
  return (
    <div className="flex items-center" style={{ gap: 0, height: size }}>
      <img
        src="/auditscope-icon.png"
        alt="AuditScope"
        width={iconSize}
        height={iconSize}
        style={{ display: "block", width: iconSize, height: iconSize, marginLeft: -Math.round(iconSize * 0.15), marginRight: -Math.round(iconSize * 0.05) }}
      />
      {withWordmark && (
        <span
          className="font-bold text-white tracking-tight"
          style={{ fontSize: size * 0.6, letterSpacing: "-0.02em" }}
        >
          AuditScope
        </span>
      )}
    </div>
  );
}
