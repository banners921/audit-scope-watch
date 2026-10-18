import { ChevronDown } from "lucide-react";

export type FaqItem = { q: string; a: string };

// Native <details>/<summary>: keyboard operable (Tab, Enter, Space) and
// announced as expandable by screen readers without extra ARIA.
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((f) => (
        <details key={f.q} className="as-card group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[44px] px-4 py-3 text-[14px] font-semibold text-foreground rounded-[inherit]">
            {f.q}
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="px-4 pb-4 text-[13.5px] text-muted-foreground leading-relaxed">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
