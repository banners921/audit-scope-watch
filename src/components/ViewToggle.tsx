import { LayoutGrid, List } from "lucide-react";

export type ViewMode = "grid" | "list";

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const cls = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
      active ? "bg-primary/[0.10] text-primary" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="inline-flex rounded-md border border-white/[0.08] overflow-hidden">
      <button type="button" onClick={() => onChange("grid")} className={cls(value === "grid")} aria-label="Grid view" title="Grid">
        <LayoutGrid className="w-3.5 h-3.5" /> Grid
      </button>
      <span className="w-px bg-white/[0.06]" />
      <button type="button" onClick={() => onChange("list")} className={cls(value === "list")} aria-label="List view" title="List">
        <List className="w-3.5 h-3.5" /> List
      </button>
    </div>
  );
}

// localStorage-backed helpers so each browse page can remember its preferred view
const KEY_PREFIX = "as_view_";

export function loadViewMode(key: string, fallback: ViewMode = "grid"): ViewMode {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(KEY_PREFIX + key);
  return v === "grid" || v === "list" ? v : fallback;
}

export function saveViewMode(key: string, value: ViewMode) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY_PREFIX + key, value); } catch {}
}
