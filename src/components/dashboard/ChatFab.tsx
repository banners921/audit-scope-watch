import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { AIAssistant } from "./AIAssistant";

export function ChatFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        className={`fixed z-40 bottom-5 right-5 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${
          open
            ? "bg-white/10 text-muted-foreground hover:text-white"
            : "bg-gradient-to-r from-cyan-400 to-blue-500 text-black hover:brightness-110"
        }`}
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
      </button>

      {open && (
        <div
          className="fixed z-30 bottom-20 right-5 w-[min(420px,calc(100vw-2.5rem))] h-[min(640px,calc(100vh-7rem))] shadow-2xl rounded-2xl overflow-hidden border border-white/10 bg-[#0F1420]"
          role="dialog"
          aria-label="AI assistant"
        >
          <AIAssistant />
        </div>
      )}
    </>
  );
}
