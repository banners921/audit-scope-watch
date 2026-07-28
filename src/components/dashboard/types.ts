export type TargetCompany = {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
  audit_count: number | null;
  has_bug_bounty: boolean | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  unique_auditor_count: number | null;
  url: string | null;
  twitter: string | null;
  github: string[] | null;
  chains: string[];
  smart_contract_language: string | null;
  protocol_slugs: string[];
};

export type DashboardFilters = {
  language: string;
  chain: string;
  minTvl: number;
  auditStatus: "any" | "never" | "stale" | "recent";
  bugBounty: "any" | "yes" | "no";
};

export const DEFAULT_FILTERS: DashboardFilters = {
  language: "",
  chain: "",
  minTvl: 0,
  auditStatus: "any",
  bugBounty: "any",
};
