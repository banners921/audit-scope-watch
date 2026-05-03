import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qktjbtmcjrwzmtqnszbq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrdGpidG1janJ3em10cW5zemJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDI5MjQsImV4cCI6MjA5MzQxODkyNH0.26UQbq8lEadma5fEZUeNKGOQUsCkBdaeylUcGATrfT8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
  },
});

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[] | null;
  tvl_usd: number | null;
  tvl_7d_change: number | null;
  security_score: number | null;
  has_been_hacked: boolean | null;
  hack_count: number | null;
  has_bug_bounty: boolean | null;
  bug_bounty_amount: number | null;
  bug_bounty_url: string | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  has_active_contracts: boolean | null;
  logo: string | null;
  url: string | null;
  twitter: string | null;
  github: string[] | null;
  description: string | null;
};

export type AuditRecord = {
  id: string;
  protocol_slug: string;
  protocol_name: string | null;
  audit_firm: string | null;
  audit_date: string | null;
  report_url: string | null;
  audit_type: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  notes: string | null;
};

export type SignalAlert = {
  id: string;
  protocol_slug: string;
  protocol_name: string | null;
  alert_type: string;
  alert_data: Record<string, unknown> | null;
  severity: string | null;
  fired_at: string;
};

export type UserAlert = {
  id: string;
  user_id: string;
  alert_name: string | null;
  category_filter: string[] | null;
  min_tvl: number | null;
  score_threshold: number | null;
  trigger_types: string[] | null;
  slack_webhook: string | null;
  telegram_chat_id: string | null;
  is_active: boolean;
  created_at: string;
};
