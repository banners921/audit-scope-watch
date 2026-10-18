import { lazy, Suspense, useEffect, useRef, useState } from "react";

const RadarScanner = lazy(() => import("@/components/RadarScanner").then((m) => ({ default: m.RadarScanner })));

// The radar re-renders every animation frame, so it loads in its own chunk,
// mounts only once it scrolls into view, and stays still for reduced-motion
// users. The box is sized up front so nothing shifts when it appears.
export function LazyRadar({ size = 300 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [still] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Radar animation representing AuditScope scanning crypto projects for new audits"
      className="max-w-full"
      style={{ width: size, height: size }}
    >
      {visible && (
        <Suspense fallback={null}>
          <RadarScanner active={!still} size={size} />
        </Suspense>
      )}
    </div>
  );
}
