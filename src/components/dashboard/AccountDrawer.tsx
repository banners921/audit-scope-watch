import { useEffect } from "react";
import { X } from "lucide-react";
import { AccountResearch } from "./AccountResearch";

type Props = {
  slug: string | null;
  onClose: () => void;
};

export function AccountDrawer({ slug, onClose }: Props) {
  useEffect(() => {
    if (!slug) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [slug, onClose]);

  if (!slug) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl bg-[#0F1420] border-l border-white/10 shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Account research"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-white p-2 rounded-md hover:bg-white/[0.04]"
        >
          <X className="w-4 h-4" />
        </button>
        <AccountResearch slug={slug} />
      </div>
    </div>
  );
}
