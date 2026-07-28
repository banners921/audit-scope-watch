import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check, X, Calendar } from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { CompanyLogo } from "@/components/CompanyLogo";

type ReminderRow = {
  id: string;
  company_slug: string;
  company_name: string | null;
  remind_at: string;
  note: string | null;
  source: string | null;
  status: "pending" | "done" | "dismissed";
  created_at: string;
};

type CompanyLite = { slug: string; logo: string | null; name: string };

export default function Reminders() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const reminders = useQuery({
    queryKey: ["reminders", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<ReminderRow[]> => {
      const { data, error } = await supabase
        .from("reminders")
        .select("*")
        .eq("user_id", user!.id)
        .order("remind_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ReminderRow[];
    },
  });

  const slugs = useMemo(
    () => Array.from(new Set((reminders.data || []).map((r) => r.company_slug))),
    [reminders.data],
  );

  const companies = useQuery({
    queryKey: ["reminders-companies", slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug,name,logo")
        .in("slug", slugs);
      if (error) throw error;
      const map = new Map<string, CompanyLite>();
      (data || []).forEach((c: CompanyLite) => map.set(c.slug, c));
      return map;
    },
  });

  async function update(id: string, status: "done" | "dismissed") {
    try {
      const { error } = await supabase
        .from("reminders")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success(status === "done" ? "Marked as done" : "Dismissed");
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["reminders-due-count"] });
    } catch (e) {
      toast.error(`Update failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    }
  }

  const all = reminders.data || [];
  const pending = all.filter((r) => r.status === "pending");
  const due = pending.filter((r) => isPast(new Date(r.remind_at)));
  const upcoming = pending.filter((r) => !isPast(new Date(r.remind_at)));
  const completed = all.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-5 max-w-[1000px]">
      <div>
        <h2 className="text-xl font-bold text-white">Reminders</h2>
        <p className="text-sm text-muted-foreground">
          Follow-ups for accounts you're tracking. We surface what's due so nothing slips.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Due now" value={due.length} accent={due.length > 0 ? "text-amber-300" : "text-white"} />
        <StatCard label="Upcoming" value={upcoming.length} />
        <StatCard label="Completed" value={completed.length} />
      </div>

      <Section title="Due now" icon={<BellRing className="w-4 h-4 text-amber-300" />} rows={due} companies={companies.data} onUpdate={update} emptyText="Nothing due right now." />
      <Section title="Upcoming" icon={<Calendar className="w-4 h-4 text-primary" />} rows={upcoming} companies={companies.data} onUpdate={update} emptyText="No upcoming reminders." />
      <Section title="Completed" icon={<Check className="w-4 h-4 text-emerald-400" />} rows={completed} companies={companies.data} onUpdate={update} emptyText="No completed reminders yet." muted />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="as-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold font-mono ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  rows,
  companies,
  onUpdate,
  emptyText,
  muted = false,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ReminderRow[];
  companies: Map<string, CompanyLite> | undefined;
  onUpdate: (id: string, status: "done" | "dismissed") => void;
  emptyText: string;
  muted?: boolean;
}) {
  return (
    <div className="as-card">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-xs font-mono text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">{emptyText}</div>
      ) : (
        <ul className={`divide-y divide-white/[0.04] ${muted ? "opacity-60" : ""}`}>
          {rows.map((r) => {
            const c = companies?.get(r.company_slug);
            const overdue = r.status === "pending" && isPast(new Date(r.remind_at));
            return (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <CompanyLogo
                  logo={c?.logo || null}
                  url={null}
                  name={c?.name || r.company_name || r.company_slug}
                  className="w-8 h-8 rounded-md shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/companies/${r.company_slug}`}
                    className="text-sm font-semibold text-white hover:text-primary truncate block"
                  >
                    {c?.name || r.company_name || r.company_slug}
                  </Link>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    {overdue ? (
                      <span className="text-amber-300">
                        Overdue · was {formatDistanceToNow(new Date(r.remind_at), { addSuffix: true })}
                      </span>
                    ) : (
                      <span>
                        {format(new Date(r.remind_at), "MMM d, yyyy")} ·{" "}
                        {formatDistanceToNow(new Date(r.remind_at), { addSuffix: true })}
                      </span>
                    )}
                    {r.source && <span className="ml-2 opacity-70">from {r.source}</span>}
                  </div>
                </div>
                {r.status === "pending" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onUpdate(r.id, "done")}
                      title="Mark done"
                      className="p-1.5 rounded text-muted-foreground hover:text-emerald-400 hover:bg-white/[0.04]"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdate(r.id, "dismissed")}
                      title="Dismiss"
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-white/[0.04]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
