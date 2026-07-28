import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { callAnthropic, ChatMessage } from "@/lib/anthropic";

const SUGGESTIONS = [
  "Who worked with Halborn and needs a re-audit?",
  "10 Solana protocols with no bug bounty and $1M+ TVL",
  "Which protocols raised funding in the last 3 months?",
  "Best angle to pitch to Trail of Bits clients?",
];

const SYSTEM_PROMPT = `You are AuditScope AI, a sales intelligence assistant for web3 security firms. You have access to data on 3,859 protocols, 6,161 companies, 1,876 audit records across 45 audit firms, 270 bug bounties, and 3,339 funding rounds in the web3 ecosystem. Help the user find prospects, identify security gaps, and craft outreach strategy. Be specific and actionable. Always reference real company and protocol names.`;

export function AIAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const reply = await callAnthropic({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: next.slice(-10),
      });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="as-card flex flex-col h-full overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !loading ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Try one of these:</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left text-xs px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-muted-foreground hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm ${m.role === "user" ? "text-white" : "text-muted-foreground"}`}
            >
              <div
                className={`inline-block max-w-full rounded-xl px-3 py-2 ${
                  m.role === "user"
                    ? "bg-primary/10 border border-primary/30 text-white"
                    : "bg-white/[0.03] border border-white/[0.06] text-white"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans leading-relaxed text-xs">{m.content}</pre>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        {error && (
          <div className="text-xs text-destructive border border-destructive/40 bg-destructive/10 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-white/[0.06] p-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about prospects, audits, signals..."
          className="as-input text-sm"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="as-btn as-btn-primary px-3 py-2 disabled:opacity-40"
          aria-label="Send"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
