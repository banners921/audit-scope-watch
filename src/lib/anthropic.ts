const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;

export type ChatMessage = { role: "user" | "assistant"; content: string };

type AnthropicCallOptions = {
  system: string;
  messages: ChatMessage[];
  max_tokens?: number;
  model?: string;
};

export async function callAnthropic({
  system,
  messages,
  max_tokens = 1000,
  model = "claude-sonnet-4-20250514",
}: AnthropicCallOptions): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "Missing VITE_ANTHROPIC_API_KEY. Set it in your .env (e.g. VITE_ANTHROPIC_API_KEY=sk-ant-...)",
    );
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Anthropic API error ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  const block = Array.isArray(data?.content) ? data.content.find((b: { type: string }) => b.type === "text") : null;
  return block?.text || "";
}
