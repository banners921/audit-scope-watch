type Axis = {
  label: string;
  /** 0-100 */
  value: number | null;
  /** Optional short value display next to label (e.g. "$1.2B", "12 audits", "3mo"). Falls back to score. */
  display?: string;
  /** Optional sub-line shown under label (very compact). */
  sub?: string | null;
};

type Props = {
  axes: Axis[]; // exactly 6
  centerLabel?: string;
  centerValue?: string | number;
  centerTone?: "strong" | "solid" | "concerning" | "weak" | "critical" | "neutral";
  size?: number; // px
  /** "fund" = green data polygon · "sales" = primary/cyan polygon */
  variant?: "fund" | "sales";
};

const TONE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  strong: { fill: "rgba(16,185,129,0.18)", stroke: "#10b981", text: "text-emerald-200" },
  solid: { fill: "rgba(14,165,233,0.18)", stroke: "#0ea5e9", text: "text-sky-200" },
  concerning: { fill: "rgba(245,158,11,0.18)", stroke: "#f59e0b", text: "text-amber-200" },
  weak: { fill: "rgba(249,115,22,0.18)", stroke: "#f97316", text: "text-orange-200" },
  critical: { fill: "rgba(244,63,94,0.20)", stroke: "#f43f5e", text: "text-rose-200" },
  neutral: { fill: "rgba(99,102,241,0.18)", stroke: "#6366f1", text: "text-indigo-200" },
};

export function HexagonScore({ axes, centerLabel, centerValue, centerTone = "neutral", size = 280, variant = "fund" }: Props) {
  if (axes.length !== 6) throw new Error("HexagonScore requires exactly 6 axes");
  const cx = size / 2;
  const cy = size / 2;
  const maxR = (size / 2) * 0.62; // leave room for labels

  // Hexagon point at axis index i (0 at top, clockwise)
  function axisPoint(i: number, scale: number): { x: number; y: number } {
    const angle = (Math.PI / 3) * i - Math.PI / 2; // start at top
    const r = maxR * scale;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }
  function labelPoint(i: number, padPx: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const r = maxR + padPx;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const anchor = Math.abs(x - cx) < 5 ? "middle" : x < cx ? "end" : "start";
    return { x, y, anchor };
  }

  // Background grid: 3 hex rings at 33%, 66%, 100%
  const rings = [0.33, 0.66, 1].map(scale => {
    const pts = Array.from({ length: 6 }, (_, i) => axisPoint(i, scale));
    return pts.map(p => `${p.x},${p.y}`).join(" ");
  });

  // Spokes from center to each axis tip
  const spokes = Array.from({ length: 6 }, (_, i) => axisPoint(i, 1));

  // Data polygon
  const dataPts = axes.map((a, i) => {
    const v = a.value == null ? 0 : Math.max(0, Math.min(100, a.value));
    return axisPoint(i, v / 100);
  });
  const dataPath = dataPts.map(p => `${p.x},${p.y}`).join(" ");

  const fundFill = "rgba(16,185,129,0.18)";
  const fundStroke = "#10b981";
  const salesFill = "rgba(6,182,212,0.20)";
  const salesStroke = "#06b6d4";
  const polyFill = variant === "sales" ? salesFill : fundFill;
  const polyStroke = variant === "sales" ? salesStroke : fundStroke;

  const tone = TONE_COLORS[centerTone] ?? TONE_COLORS.neutral;

  return (
    <div className="relative inline-block">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="select-none">
        {/* Background rings */}
        {rings.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill={i === 2 ? "rgba(255,255,255,0.015)" : "none"}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        ))}
        {/* Spokes */}
        {spokes.map((p, i) => (
          <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        ))}
        {/* Data polygon */}
        <polygon points={dataPath} fill={polyFill} stroke={polyStroke} strokeWidth={1.5} />
        {/* Data dots */}
        {dataPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={polyStroke} />
        ))}
        {/* Axis labels */}
        {axes.map((a, i) => {
          const lp = labelPoint(i, 20);
          const v = a.value == null ? "—" : Math.round(a.value).toString();
          return (
            <g key={i}>
              <text x={lp.x} y={lp.y - 5} textAnchor={lp.anchor} className="fill-muted-foreground" fontSize={10} fontWeight={500} style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {a.label}
              </text>
              <text x={lp.x} y={lp.y + 9} textAnchor={lp.anchor} className="fill-white" fontSize={12} fontWeight={700}>
                {a.display ?? v}
              </text>
              {a.sub && (
                <text x={lp.x} y={lp.y + 22} textAnchor={lp.anchor} className="fill-muted-foreground" fontSize={9}>
                  {a.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Center label */}
      {(centerLabel || centerValue != null) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`rounded-lg border px-3 py-1.5 backdrop-blur-sm ${tone.text}`} style={{ background: tone.fill, borderColor: tone.stroke + "55" }}>
            {centerLabel && <div className="text-[9px] uppercase tracking-[0.1em] font-semibold opacity-80 text-center">{centerLabel}</div>}
            {centerValue != null && <div className="text-base font-bold tabular-nums text-center mt-0.5 leading-none">{centerValue}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
