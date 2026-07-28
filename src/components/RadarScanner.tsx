import { useEffect, useRef, useState } from "react";

type Props = {
  size?: number;
  active: boolean;
  /** kept for API compatibility; the radar self-drives its targets */
  progress?: number;
};

type Target = {
  id: number;
  ang: number;     // degrees, position around the dish
  rad: number;     // 0..1 fraction of maxR
  size: number;    // base px radius
  bright: number;  // 0..1 current glow (spikes when swept, then decays)
  hue: string;     // blip color
  drift: number;   // angular drift speed (deg/s)
};

const SWEEP_DEG_PER_S = 60;   // one revolution ~6s — calm, not frantic
const DECAY_PER_S = 1.5;      // how fast a pinged blip fades back down
const MIN_TARGETS = 14;
const MAX_TARGETS = 22;

function rand(a: number, b: number) { return a + Math.random() * (b - a); }

function makeTarget(id: number): Target {
  const emerald = Math.random() < 0.22;
  return {
    id,
    ang: rand(0, 360),
    rad: rand(0.16, 0.95),
    size: rand(1.6, 4.2),
    bright: 0,
    hue: emerald ? "#34D399" : "#67E8F9",
    drift: rand(-6, 6),
  };
}

// True if the sweep passed over `targetAng` going from prev->cur (handles 360 wrap).
function swept(prev: number, cur: number, targetAng: number) {
  if (prev <= cur) return targetAng > prev && targetAng <= cur;
  // wrapped past 360
  return targetAng > prev || targetAng <= cur;
}

export function RadarScanner({ size = 320, active }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = (size / 2) * 0.92;

  const angleRef = useRef(0);
  const targetsRef = useRef<Target[]>(
    Array.from({ length: MIN_TARGETS + 4 }, (_, i) => makeTarget(i))
  );
  const nextIdRef = useRef(targetsRef.current.length);
  const spawnAccRef = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;

      const prev = angleRef.current;
      const cur = (prev + dt * SWEEP_DEG_PER_S) % 360;
      angleRef.current = cur;

      const decay = Math.exp(-DECAY_PER_S * dt);
      const ts = targetsRef.current;
      for (const tg of ts) {
        // drift slowly so the field feels alive
        tg.ang = (tg.ang + tg.drift * dt + 360) % 360;
        tg.rad = Math.min(0.96, Math.max(0.12, tg.rad + rand(-0.03, 0.03) * dt));
        // ping when the beam crosses this target
        if (swept(prev, cur, tg.ang)) tg.bright = 1;
        else tg.bright *= decay;
      }

      // lifecycle: retire faded blips and bring new ones in over time
      spawnAccRef.current += dt;
      if (spawnAccRef.current > 0.9) {
        spawnAccRef.current = 0;
        // drop a fully-faded one occasionally so targets cycle in/out
        if (ts.length > MIN_TARGETS && Math.random() < 0.5) {
          const idx = ts.findIndex((x) => x.bright < 0.04);
          if (idx >= 0) ts.splice(idx, 1);
        }
        if (ts.length < MAX_TARGETS && Math.random() < 0.7) {
          ts.push(makeTarget(nextIdRef.current++));
        }
      }

      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const beam = angleRef.current;
  const toXY = (angDeg: number, r: number) => {
    const a = (angDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  // Comet trail: fading radial lines behind the leading edge.
  const TRAIL = 26;
  const trailSpan = 96; // degrees
  const trailLines = Array.from({ length: TRAIL }, (_, i) => {
    const f = i / TRAIL;
    const p = toXY(beam - f * trailSpan, maxR);
    return { x: p.x, y: p.y, o: (1 - f) * 0.5 };
  });
  const lead = toXY(beam, maxR);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <defs>
        <radialGradient id="rs-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.10} />
          <stop offset="62%" stopColor="#22D3EE" stopOpacity={0.03} />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
        </radialGradient>
        <filter id="rs-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={maxR} fill="url(#rs-bg)" stroke="rgba(34,211,238,0.18)" strokeWidth={1} />

      {/* range rings */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <circle key={i} cx={cx} cy={cy} r={maxR * f} fill="none"
          stroke="rgba(34,211,238,0.12)" strokeWidth={0.5} strokeDasharray={i === 3 ? "0" : "2 4"} />
      ))}
      {/* crosshair */}
      <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="rgba(34,211,238,0.09)" strokeWidth={0.5} />
      <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="rgba(34,211,238,0.09)" strokeWidth={0.5} />

      {/* sweep trail */}
      {active && trailLines.map((l, i) => (
        <line key={i} x1={cx} y1={cy} x2={l.x} y2={l.y} stroke="#22D3EE" strokeWidth={1} strokeOpacity={l.o} strokeLinecap="round" />
      ))}
      {active && (
        <line x1={cx} y1={cy} x2={lead.x} y2={lead.y} stroke="#7DE9F7" strokeWidth={1.6} strokeOpacity={0.9} strokeLinecap="round" />
      )}

      {/* targets — flash when swept, fade out, vary in size */}
      {targetsRef.current.map((tg) => {
        if (tg.bright < 0.03) return null;
        const p = toXY(tg.ang, tg.rad * maxR);
        const r = tg.size * (0.7 + 0.5 * tg.bright);
        return (
          <g key={tg.id} filter="url(#rs-glow)">
            <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke={tg.hue} strokeWidth={0.75} opacity={tg.bright * 0.45} />
            <circle cx={p.x} cy={p.y} r={r} fill={tg.hue} opacity={Math.min(1, tg.bright + 0.15)} />
          </g>
        );
      })}

      {/* center */}
      <circle cx={cx} cy={cy} r={2.5} fill="#22D3EE" />
      <circle cx={cx} cy={cy} r={6} fill="none" stroke="#22D3EE" strokeWidth={1} opacity={0.4}>
        <animate attributeName="r" from="3" to="14" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.5" to="0" dur="2.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
