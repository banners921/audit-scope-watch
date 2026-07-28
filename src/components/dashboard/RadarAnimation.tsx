import { useEffect, useState } from "react";

const DEFAULT_MESSAGES = [
  "Scanning candidate pool…",
  "Cross-referencing investors…",
  "Weighing audit cadence…",
  "Reasoning about tech fit…",
  "Diversifying across tiers…",
];

// Sweep period — slower CoD vibe.
const SWEEP_SECONDS = 3.2;

// Fixed blip positions around the radar dial, with delays timed to when
// the sweep arm passes their angle (delay = (angleDeg / 360) * SWEEP_SECONDS).
// Computed approx positions on a circle (radius ~36% from center).
type Blip = { top: string; left: string; delay: string; size: number };
const BLIPS: Blip[] = [
  { top: "20%", left: "70%", delay: "0.40s", size: 4 },  // ~45°  upper-right
  { top: "44%", left: "86%", delay: "0.85s", size: 5 },  // ~95°  right
  { top: "78%", left: "70%", delay: "1.45s", size: 4 },  // ~140° lower-right
  { top: "82%", left: "34%", delay: "1.95s", size: 5 },  // ~210° lower-left
  { top: "52%", left: "14%", delay: "2.40s", size: 4 },  // ~265° left
  { top: "22%", left: "32%", delay: "2.85s", size: 3 },  // ~320° upper-left
];

type Props = {
  /** Override the rotating status text. */
  messages?: string[];
  /** Compact mode for inline use (smaller radar). */
  compact?: boolean;
};

export function RadarAnimation({ messages, compact = false }: Props) {
  const msgs = messages && messages.length > 0 ? messages : DEFAULT_MESSAGES;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % msgs.length), 1600);
    return () => clearInterval(t);
  }, [msgs.length]);

  const radarSize = compact ? "w-24 h-24" : "w-40 h-40";
  const wrapperPadY = compact ? "py-6" : "py-10";

  return (
    <div className={`flex flex-col items-center justify-center gap-5 ${wrapperPadY} bg-black/40 rounded-xl`}>
      <div className={`relative ${radarSize}`}>
        {/* concentric rings */}
        <div className="absolute inset-0 rounded-full border border-cyan-400/20" />
        <div className="absolute inset-[18%] rounded-full border border-cyan-400/25" />
        <div className="absolute inset-[36%] rounded-full border border-cyan-400/35" />
        <div className="absolute inset-[52%] rounded-full border border-cyan-400/55" />

        {/* crosshair lines */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-cyan-400/15" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-cyan-400/15" />

        {/* outer pulse */}
        <div className="absolute inset-0 rounded-full border border-cyan-400/30 animate-ping" />

        {/* sweep arm — slower */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(34,211,238,0) 0deg, rgba(34,211,238,0) 285deg, rgba(34,211,238,0.55) 358deg, rgba(34,211,238,0) 360deg)",
            animation: `radar-spin ${SWEEP_SECONDS}s linear infinite`,
          }}
        />

        {/* blips — synced to sweep arm via delay */}
        {BLIPS.map((b, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-cyan-300"
            style={{
              top: b.top,
              left: b.left,
              width: `${b.size}px`,
              height: `${b.size}px`,
              marginLeft: `-${b.size / 2}px`,
              marginTop: `-${b.size / 2}px`,
              boxShadow: "0 0 8px rgba(34,211,238,0.9)",
              opacity: 0,
              animation: `radar-blip ${SWEEP_SECONDS}s linear infinite`,
              animationDelay: b.delay,
            }}
          />
        ))}

        {/* center pip */}
        <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
      </div>
      <div className="text-xs text-cyan-300/90 font-mono tracking-wide">{msgs[idx]}</div>
      <style>{`
        @keyframes radar-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes radar-blip {
          0%, 4%   { opacity: 0; transform: scale(1); }
          6%       { opacity: 1; transform: scale(1.6); }
          9%       { opacity: 1; transform: scale(1.2); }
          25%      { opacity: 0.5; transform: scale(1); }
          50%      { opacity: 0; transform: scale(1); }
          100%     { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
