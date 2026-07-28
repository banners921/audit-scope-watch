import { useEffect, useRef, useState, useMemo } from "react";
import { ChevronDown, Check, X, Search } from "lucide-react";

export type Option = { value: string; label: string; count?: number };

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  multi = false,
  values,
  onMultiChange,
  loading,
  maxHeight = 320,
}: {
  value?: string | null;
  values?: string[];
  options: Option[];
  onChange?: (v: string | null) => void;
  onMultiChange?: (vs: string[]) => void;
  placeholder?: string;
  multi?: boolean;
  loading?: boolean;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s));
  }, [options, search]);

  const display = multi
    ? values && values.length > 0
      ? values.length === 1
        ? options.find((o) => o.value === values[0])?.label || values[0]
        : `${values.length} selected`
      : placeholder
    : value
      ? options.find((o) => o.value === value)?.label || value
      : placeholder;

  const isPlaceholder = multi ? !values || values.length === 0 : !value;

  const select = (v: string) => {
    if (multi) {
      const cur = values || [];
      onMultiChange?.(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    } else {
      onChange?.(v === value ? null : v);
      setOpen(false);
      setSearch("");
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (multi) onMultiChange?.([]);
    else onChange?.(null);
  };

  const hasSelection = multi ? (values?.length ?? 0) > 0 : !!value;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-between gap-1.5 min-w-[140px] px-2.5 py-1.5 rounded-md border text-[11.5px] font-medium transition-colors ${
          hasSelection ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.08] text-foreground hover:bg-white/[0.03]"
        }`}
      >
        <span className={`truncate ${isPlaceholder ? "text-muted-foreground" : ""}`}>{display}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {hasSelection && (
            <span
              role="button"
              tabIndex={0}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={clearAll}
              className="rounded p-0.5 hover:bg-white/[0.08] cursor-pointer"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 min-w-[260px] left-0 as-card shadow-xl border border-white/[0.08] rounded-md overflow-hidden">
          <div className="p-2 border-b border-white/[0.06] sticky top-0 bg-surface">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full pl-6 pr-2 py-1.5 rounded text-[11.5px] bg-white/[0.03] border border-white/[0.06] focus:outline-none focus:border-primary/40"
              />
            </div>
            {multi && (values?.length ?? 0) > 0 && (
              <button
                onClick={() => onMultiChange?.([])}
                className="mt-1.5 w-full text-[10.5px] text-muted-foreground hover:text-rose-300 text-left"
              >
                Clear all ({values!.length})
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight }}>
            {loading && <div className="p-4 text-center text-[11px] text-muted-foreground">Loading…</div>}
            {!loading && filtered.length === 0 && (
              <div className="p-4 text-center text-[11px] text-muted-foreground">No matches</div>
            )}
            {!loading && filtered.map((opt) => {
              const active = multi ? (values?.includes(opt.value) ?? false) : value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt.value)}
                  className={`w-full px-2.5 py-1.5 text-left text-[11.5px] flex items-center justify-between gap-2 hover:bg-white/[0.03] ${active ? "text-primary bg-primary/[0.05]" : "text-foreground"}`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {multi && (
                      <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${active ? "bg-primary border-primary" : "border-white/[0.15]"}`}>
                        {active && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                    )}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {opt.count != null && (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{opt.count.toLocaleString()}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
