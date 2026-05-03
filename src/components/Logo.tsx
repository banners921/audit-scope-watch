export function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative rounded-xl flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, #22D3EE 0%, #2563EB 100%)",
        }}
      >
        <div
          className="absolute rounded-full border-2 border-white/90"
          style={{ width: size * 0.55, height: size * 0.55 }}
        />
        <div className="absolute rounded-full bg-white" style={{ width: size * 0.16, height: size * 0.16 }} />
        <div className="absolute bg-white/80" style={{ width: 1, height: size * 0.85 }} />
        <div className="absolute bg-white/80" style={{ width: size * 0.85, height: 1 }} />
      </div>
      {withWordmark && (
        <span className="font-bold text-white tracking-tight" style={{ fontSize: size * 0.6 }}>
          AuditScope
        </span>
      )}
    </div>
  );
}
