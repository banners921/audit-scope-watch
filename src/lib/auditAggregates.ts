// Aggregates audit-history + findings into per-company sales-relevant metrics.
// Used by Sales Mode scoring (computeSalesAxes "Audit posture" dimension)
// to reflect what makes AuditScope's data uniquely valuable for outbound:
//   - firms used / rotation
//   - tier-1 firm coverage
//   - contest-platform engagement (Sherlock / Code4rena / Cantina)
//   - finding fix rate
//
// Batched on N slugs in two queries (audit_history + audit_findings_detail).

import { supabase } from "./supabase";

export type AuditAggregate = {
  audit_count: number;
  firms_used: number;
  tier1_count: number;
  contest_count: number;
  fix_rate: number | null;  // 0-100, null if no findings
};

const T1_AUDITORS = new Set([
  "trail of bits", "openzeppelin", "consensys diligence", "consensys",
  "spearbit", "cantina", "zellic", "code4rena", "sherlock", "halborn", "certora",
]);

const normalizeFirm = (f: string | null | undefined): string =>
  (f || "").trim().toLowerCase().replace(/\s+/g, " ");

export async function fetchAuditAggregates(slugs: string[]): Promise<Map<string, AuditAggregate>> {
  const out = new Map<string, AuditAggregate>();
  if (slugs.length === 0) return out;

  // Chunked queries to keep IN-lists short on huge slug sets
  const CHUNK = 500;
  const audits: any[] = [];
  const findings: any[] = [];

  for (let i = 0; i < slugs.length; i += CHUNK) {
    const chunk = slugs.slice(i, i + CHUNK);
    const [{ data: a }, { data: f }] = await Promise.all([
      supabase
        .from("audit_history")
        .select("company_slug,audit_firm,audit_type")
        .in("company_slug", chunk),
      supabase
        .from("audit_findings_detail")
        .select("company_slug,status")
        .in("company_slug", chunk),
    ]);
    if (a) audits.push(...a);
    if (f) findings.push(...f);
  }

  const auditsBySlug = new Map<string, any[]>();
  const findingsBySlug = new Map<string, any[]>();
  for (const r of audits) {
    if (!auditsBySlug.has(r.company_slug)) auditsBySlug.set(r.company_slug, []);
    auditsBySlug.get(r.company_slug)!.push(r);
  }
  for (const r of findings) {
    if (!findingsBySlug.has(r.company_slug)) findingsBySlug.set(r.company_slug, []);
    findingsBySlug.get(r.company_slug)!.push(r);
  }

  for (const slug of slugs) {
    const a = auditsBySlug.get(slug) ?? [];
    const f = findingsBySlug.get(slug) ?? [];
    const firms = new Set<string>();
    let t1 = 0;
    let contests = 0;
    for (const row of a) {
      const norm = normalizeFirm(row.audit_firm);
      if (norm) firms.add(norm);
      if (T1_AUDITORS.has(norm)) t1++;
      if ((row.audit_type || "").toLowerCase() === "contest") contests++;
    }
    // Fix rate: out of findings with a known status, percent that are fixed.
    const known = f.filter(r => !!r.status);
    const fixed = known.filter(r => /fix/i.test(r.status)).length;
    const fix_rate = known.length > 0 ? +(fixed / known.length * 100).toFixed(1) : null;
    out.set(slug, {
      audit_count: a.length,
      firms_used: firms.size,
      tier1_count: t1,
      contest_count: contests,
      fix_rate,
    });
  }
  return out;
}
