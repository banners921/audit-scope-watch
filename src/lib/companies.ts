export type Company = {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  url: string | null;
  twitter: string | null;
  linkedin: string | null;
  telegram: string | null;
  discord: string | null;
  logo: string | null;
  location: string | null;
  country: string | null;
  employee_count: string | null;
  founded_year: string | null;
  industry: string | null;
  company_type: string | null;
  market_cap_usd: number | null;
  data_source: string | null;
};

export type FundingRound = {
  id: string;
  company_slug: string;
  round_type: string | null;
  amount_usd: number | null;
  date: string | null;
  lead_investors: string[] | string | null;
};
