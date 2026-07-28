import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { canonicalCategory, categoryTextColor } from "@/lib/categories";

export function CategoryChip({ cat, selected, onToggle, stopProp, dash = true }: {
  cat: string | null | undefined;
  selected: Set<string>;
  onToggle: (c: string) => void;
  stopProp?: boolean;
  dash?: boolean;
}) {
  const c = canonicalCategory(cat);
  if (!c) return dash ? <span className="text-muted-foreground">—</span> : null;
  const isOn = selected.has(c);
  const color = categoryTextColor(c);
  return (
    <button
      type="button"
      onClick={(e) => { if (stopProp) { e.preventDefault(); e.stopPropagation(); } onToggle(c); }}
      className={`${color} ${isOn ? "underline underline-offset-2 font-semibold" : ""} hover:brightness-125 hover:underline underline-offset-2 transition-all`}
      title={isOn ? `Remove ${c} filter` : `Filter by ${c}`}
    >
      {c}
    </button>
  );
}

export function CategoryMultiSelect({ universe, selected, onToggle, onClear, label = "Categories" }: {
  universe: string[];
  selected: Set<string>;
  onToggle: (c: string) => void;
  onClear: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return universe.filter(c => !ql || c.toLowerCase().includes(ql));
  }, [universe, q]);
  return (
    <div className="relative" ref={popRef}>
      <button type="button" onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded border border-white/[0.08] bg-white/[0.03] hover:border-primary/40 hover:bg-white/[0.05] text-white">
        <span className="text-muted-foreground">{label}</span>
        {selected.size > 0 ? (
          <span className="text-primary font-semibold tabular-nums">{selected.size}</span>
        ) : (
          <span className="text-muted-foreground">all</span>
        )}
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1.5 z-30 w-72 rounded-md border border-white/[0.1] bg-[#0e1116] shadow-xl">
          <div className="p-2 border-b border-white/[0.06]">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="w-full px-2 py-1.5 text-[11px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
            {filtered.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic px-1 py-2">No matches</div>
            ) : filtered.map(c => {
              const on = selected.has(c);
              return (
                <button key={c} type="button" onClick={() => onToggle(c)} className={`w-full text-left text-[11.5px] px-2 py-1.5 rounded inline-flex items-center gap-2 transition-colors ${on ? "bg-primary/15" : "hover:bg-white/[0.04]"}`}>
                  <span className={`w-3.5 h-3.5 rounded-sm border ${on ? "bg-primary border-primary" : "border-white/30"} inline-flex items-center justify-center text-[8px] text-black font-bold`}>{on ? "✓" : ""}</span>
                  <span className={categoryTextColor(c)}>{c}</span>
                </button>
              );
            })}
          </div>
          {selected.size > 0 && (
            <div className="px-2 py-1.5 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
              <button type="button" onClick={onClear} className="text-[10px] text-muted-foreground hover:text-white underline">Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CategoryFilterStrip({ selected, onToggle, onClear }: { selected: Set<string>; onToggle: (c: string) => void; onClear: () => void }) {
  if (selected.size === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Categories:</span>
      {Array.from(selected).map((c) => (
        <button key={c} type="button" onClick={() => onToggle(c)} className={`${categoryTextColor(c)} text-[11px] inline-flex items-center gap-1 hover:brightness-125`}>
          {c} <span aria-hidden>×</span>
        </button>
      ))}
      <button type="button" onClick={onClear} className="text-[10px] text-muted-foreground hover:text-white ml-1 underline">Clear all</button>
    </div>
  );
}
