import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

export type AutocompleteOption = {
  value: string; // stable identifier (slug/name)
  label: string;
  sublabel?: string | null;
  logo?: string | null;
};

type Props = {
  values?: string[];
  onChange?: (next: string[]) => void;
  onSelect?: (opt: AutocompleteOption) => void;
  placeholder?: string;
  emptyText?: string;
  max?: number;
  fetcher: (query: string) => Promise<AutocompleteOption[]>;
  renderChipLabel?: (value: string) => string;
};

export function AsyncAutocomplete({
  values = [],
  onChange,
  onSelect,
  placeholder = "Search…",
  emptyText = "No results",
  max,
  fetcher,
  renderChipLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AutocompleteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const rs = await fetcher(query.trim());
        if (!cancelled) setResults(rs);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, fetcher]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function add(opt: AutocompleteOption) {
    if (onSelect) {
      onSelect(opt);
      setQuery("");
      setResults([]);
      setOpen(false);
      return;
    }
    if (max && values.length >= max) return;
    if (values.includes(opt.value)) return;
    onChange?.([...values, opt.value]);
    setQuery("");
    setResults([]);
  }

  function remove(value: string) {
    onChange?.(values.filter((v) => v !== value));
  }

  const atMax = max != null && values.length >= max;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center as-input min-h-[2.5rem] py-1.5 cursor-text" onClick={() => setOpen(true)}>
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 border border-primary/30 text-xs text-primary"
          >
            {renderChipLabel ? renderChipLabel(v) : v}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
              aria-label={`Remove ${v}`}
              className="rounded p-0.5 hover:bg-primary/20"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {!atMax && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={values.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-white placeholder:text-muted-foreground"
          />
        )}
        {atMax && (
          <span className="text-xs text-muted-foreground ml-1">Max {max} reached</span>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-white/10 bg-surface shadow-xl">
          {loading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            <ul className="py-1">
              {results.map((opt) => {
                const already = values.includes(opt.value);
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      disabled={already || atMax}
                      onClick={() => add(opt)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {opt.logo ? (
                        <img
                          src={opt.logo}
                          alt=""
                          className="w-6 h-6 rounded bg-white/5 object-contain shrink-0"
                          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                        />
                      ) : (
                        <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                          {(opt.label?.[0] || "?").toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white truncate">{opt.label}</div>
                        {opt.sublabel && (
                          <div className="text-[11px] text-muted-foreground truncate">{opt.sublabel}</div>
                        )}
                      </div>
                      {already && <span className="text-[10px] text-muted-foreground">added</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
