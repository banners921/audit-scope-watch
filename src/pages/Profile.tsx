import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LogOut } from "lucide-react";
import { useState } from "react";

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [slack, setSlack] = useState("");
  const [telegram, setTelegram] = useState("");

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Account</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
            <div className="font-mono text-sm text-white mt-1">{user?.email}</div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">User ID</label>
            <div className="font-mono text-xs text-muted-foreground mt-1 truncate">{user?.id}</div>
          </div>
        </div>
      </div>

      <div className="as-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Default Notification Targets</h3>
        <p className="text-xs text-muted-foreground">
          These are saved per alert when you create them. Update existing alerts on the Alerts page.
        </p>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Slack webhook URL</label>
          <input value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="https://hooks.slack.com/…" className="as-input mt-1" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Telegram chat ID</label>
          <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="-100…" className="as-input mt-1" />
        </div>
      </div>

      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-2">Billing</h3>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="text-sm text-white font-semibold">AuditScope Pro</div>
          <div className="font-mono text-2xl font-bold text-white mt-1">$79<span className="text-base text-muted-foreground">/mo</span></div>
          <div className="text-xs text-muted-foreground mt-2">Stripe checkout coming soon.</div>
        </div>
      </div>

      <div className="as-card p-5">
        <button
          onClick={async () => { await signOut(); navigate("/login"); }}
          className="as-btn as-btn-ghost text-destructive hover:text-destructive"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
