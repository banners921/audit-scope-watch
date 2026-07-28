// Live TVL fetch from DefiLlama. No cache layer — React Query handles staleness.
// Tries the company slug first, then strips common suffixes that DefiLlama doesn't use.

async function tryOne(slug: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.llama.fi/tvl/${encodeURIComponent(slug)}`, { headers: { "User-Agent": "AuditScope/1.0" } });
    if (!r.ok) return null;
    const txt = (await r.text()).trim();
    if (!txt || txt === "0") return null;
    const n = Number(txt);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Live TVL with fallback slug attempts. Tries (in order):
 *   1. raw slug
 *   2. strip trailing -finance/-protocol/-network/-labs
 *   3. swap to -finance / -protocol if the strip didn't yield
 */
export async function fetchLiveTvl(slug: string): Promise<{ tvl: number | null; matched_slug: string | null }> {
  if (!slug) return { tvl: null, matched_slug: null };
  const attempts = new Set<string>();
  attempts.add(slug);
  const stripped = slug.replace(/-(finance|protocol|network|labs|dao|foundation|xyz)$/i, "");
  if (stripped !== slug) attempts.add(stripped);
  // Also try the most-common DefiLlama suffix swaps
  if (!/-finance$/i.test(slug)) attempts.add(`${slug}-finance`);
  if (!/-protocol$/i.test(slug)) attempts.add(`${slug}-protocol`);
  for (const a of attempts) {
    const v = await tryOne(a);
    if (v != null) return { tvl: v, matched_slug: a };
  }
  return { tvl: null, matched_slug: null };
}
