import { useEffect, useState } from "react";

type Blip = { x: number; y: number; bright: number; id: number };

type Props = {
  size?: number;
  active: boolean;
  /** 0-1, fraction of search done */
  progress?: number;
};

// Bloomberg-style radar: sweeping beam + procedurally placed blips that "appear" as the beam passes.
export function RadarScanner({ size = 380, active, progress = 0 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = (size / 2) * 0.92;
  const [angle, setAngle] = useState(0);
  const [blips, setBlips] = useState<Blip[]>([]);

  useEffect(() => {
    if (!active) return;
    let rafId: number;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setAngle((a) => (a + dt * 180) % 360); // 180°/s
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active]);

  // Procedurally seed blips based on progress — more appear as scan advances.
  useEffect(() => {
    if (!active) { setBlips([]); return; }
    const target = Math.floor(progress * 28);
    if (blips.length < target) {
      const additions: Blip[] = [];
      for (let i = blips.length; i < target; i++) {
        const r = (0.25 + Math.random() * 0.7) * maxR;
        const theta = Math.random() * Math.PI * 2;
        additions.push({
          x: cx + r * Math.cos(theta),
          y: cy + r * Math.sin(theta),
          bright: 0.4 + Math.random() * 0.6,
          id: Date.now() + i,
        });
      }
      setBlips((b) => [...b, ...additions]);
    }
  }, [progress, active, blips.length, cx, cy, maxR]);

  // Sweep beam: triangle from center to outer arc, rotated by angle.
  const beamRad = (angle * Math.PI) / 180;
  const beamArc = 35; // degrees
  const a1 = beamRad - (beamArc * Math.PI) / 360;
  const a2 = beamRad + (beamArc * Math.PI) / 360;
  const beamP1 = { x: cx + maxR * Math.cos(a1), y: cy + maxR * Math.sin(a1) };
  const beamP2 = { x: cx + maxR * Math.cos(a2), y: cy + maxR * Math.sin(a2) };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <radialGradient id="rs-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.10} />
          <stop offset="60%" stopColor="#22D3EE" stopOpacity={0.03} />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="rs-beam" gradientUnits="userSpaceOnUse" x1={cx} y1={cy} x2={beamP1.x} y2={beamP1.y}>
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
        </linearGradient>
      </defs>

      <circle cx={cx} cy={cy} r={maxR} fill="url(#rs-bg)" stroke="rgba(34,211,238,0.18)" strokeWidth={1} />

      {/* Concentric rings */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <circle key={i} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth={0.5} strokeDasharray={i === 3 ? "0" : "2 3"} />
      ))}

      {/* Crosshair lines */}
      <line x1={cx} y1={0} x2={cx} y2={size} stroke="rgba(34,211,238,0.08)" strokeWidth={0.5} />
      <line x1={0} y1={cy} x2={size} y2={cy} stroke="rgba(34,211,238,0.08)" strokeWidth={0.5} />

      {/* Blips */}
      {blips.map((b) => (
        <g key={b.id}>
          <circle cx={b.x} cy={b.y} r={2} fill="#67E8F9" opacity={b.bright} />
          <circle cx={b.x} cy={b.y} r={4} fill="none" stroke="#67E8F9" strokeWidth={0.5} opacity={b.bright * 0.5} />
        </g>
      ))}

      {/* Sweep beam */}
      {active && (
        <polygon
          points={`${cx},${cy} ${beamP1.x},${beamP1.y} ${beamP2.x},${beamP2.y}`}
          fill="url(#rs-beam)"
        />
      )}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3} fill="#22D3EE" />
      <circle cx={cx} cy={cy} r={6} fill="none" stroke="#22D3EE" strokeWidth={1} opacity={0.4}>
        <animate attributeName="r" from="3" to="12" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
