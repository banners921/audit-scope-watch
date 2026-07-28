import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Key, Copy, Trash2, Loader2, Plus, Check, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  request_count: number | null;
  created_at: string;
  revoked_at: string | null;
};

const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string) || "https://qktjbtmcjrwzmtqnszbq.supabase.co";

async function callManageKeys(action: "list" | "create" | "revoke", payload?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in required");
  const r = await fetch(`${API_BASE}/functions/v1/manage-api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...(payload || {}) }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export function ApiKeysSection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ plain: string; id: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQ = useQuery({
    queryKey: ["api-keys", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<ApiKey[]> => {
      const j = await callManageKeys("list");
      return (j.keys || []) as ApiKey[];
    },
  });

  async function generate() {
    const name = newKeyName.trim() || "Default key";
    setCreating(true);
    try {
      const j = await callManageKeys("create", { name });
      setRevealedKey({ plain: j.plain_key, id: j.key?.id });
      setNewKeyName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key created — copy it now, it won't be shown again");
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke "${name}"? Any integration using it will stop working immediately.`)) return;
    try {
      await callManageKeys("revoke", { id });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("Revoked");
    } catch (e) {
      toast.error(`Revoke failed: ${(e as Error).message}`);
    }
  }

  function copyKey() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey.plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const active = (keysQ.data || []).filter((k) => !k.revoked_at);
  const revoked = (keysQ.data || []).filter((k) => k.revoked_at);

  return (
    <div className="as-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-white">API keys</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Read-only access to our audit database — all auditors, audit history per company, report URLs, findings counts.
        Use these in your own dashboards, Zaps, or back-end automations.
      </p>

      {/* Revealed-just-now banner */}
      {revealedKey && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <AlertCircle className="w-4 h-4" /> This is the only time the full key is shown. Copy it now.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono bg-black/30 px-2 py-1.5 rounded border border-white/[0.06] text-white break-all">
              {revealedKey.plain}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="as-btn as-btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setRevealedKey(null)}
            className="text-[11px] text-muted-foreground hover:text-white"
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Generate */}
      <div className="flex gap-2">
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name (e.g. 'production', 'zapier-pipeline')"
          className="as-input flex-1"
          maxLength={60}
        />
        <button
          type="button"
          onClick={generate}
          disabled={creating}
          className="as-btn as-btn-primary whitespace-nowrap disabled:opacity-50"
        >
          {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating</> : <><Plus className="w-4 h-4" /> Generate key</>}
        </button>
      </div>

      {/* Active keys list */}
      {keysQ.isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading keys…</div>
      ) : active.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2 italic">No active keys yet.</div>
      ) : (
        <div className="space-y-2">
          {active.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white truncate">{k.name}</span>
                  <code className="text-[10px] font-mono text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{k.key_prefix}…</code>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Created {new Date(k.created_at).toLocaleDateString()} ·
                  {k.last_used_at ? ` Last used ${new Date(k.last_used_at).toLocaleString()}` : " Never used"}
                  {k.request_count != null && k.request_count > 0 && ` · ${k.request_count.toLocaleString()} requests`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(k.id, k.name)}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Revoked (collapsed) */}
      {revoked.length > 0 && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-white">
            {revoked.length} revoked key{revoked.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-1">
            {revoked.map((k) => (
              <div key={k.id} className="text-[11px] text-muted-foreground/70 flex items-center gap-2">
                <code className="font-mono">{k.key_prefix}…</code>
                <span>{k.name}</span>
                <span className="ml-auto">revoked {new Date(k.revoked_at!).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Quick docs */}
      <details className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
        <summary className="text-xs uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-white">
          How to use the API
        </summary>
        <div className="mt-2 space-y-3 text-[12.5px] text-muted-foreground leading-relaxed">
          <p>
            Send your key via the <code className="font-mono text-white bg-black/30 px-1 rounded">X-API-Key</code> header
            (or <code className="font-mono text-white bg-black/30 px-1 rounded">?key=</code> query param for quick tests).
          </p>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Endpoints</div>
            <ul className="space-y-0.5 font-mono text-[11px] text-white/85">
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=firms</li>
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=firm&slug=trail-of-bits</li>
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=firm-audits&slug=cyfrin&limit=50</li>
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=company&slug=aave</li>
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=audits-recent&since=2026-04-01</li>
              <li><span className="text-emerald-400">GET</span> {API_BASE}/functions/v1/audit-api?action=audit&id=&lt;uuid&gt;</li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Example curl</div>
            <pre className="text-[11px] font-mono bg-black/30 p-2 rounded border border-white/[0.06] text-white/85 overflow-x-auto">
{`curl -H "X-API-Key: as_live_..." \\
  "${API_BASE}/functions/v1/audit-api?action=company&slug=aave"`}
            </pre>
          </div>
          <a
            href={`${API_BASE}/functions/v1/audit-api?action=docs&key=YOUR_KEY`}
            target="_blank" rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1 text-[12px]"
          >
            Live JSON docs <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </details>
    </div>
  );
}
