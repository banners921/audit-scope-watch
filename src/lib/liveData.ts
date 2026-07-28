// Helpers for live external data (DefiLlama + GitHub)

export const GITHUB_TOKEN = "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";

export function ghHeaders(): HeadersInit {
  return {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
}

export function parseGithubRepo(url: string | null | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

export async function fetchLlamaTvl(slug: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.llama.fi/tvl/${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    const v = await r.json();
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Fetch monthly TVL history (oldest→newest) for a DefiLlama protocol slug, last `months` months.
 * Aggregates across real chains (skipping `-staking`, `-borrowed`, `-pool2` sub-buckets).
 * Returns N numbers, padded with 0 for months without data.
 */
export async function fetchLlamaTvlHistory(slug: string, months = 12): Promise<number[]> {
  try {
    const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
    if (!r.ok) return new Array(months).fill(0);
    const data = await r.json();
    const chainTvls: Record<string, { tvl?: { date: number; totalLiquidityUSD: number }[] }> = data.chainTvls || {};
    // For each real chain, build map of yyyy-mm → tvl on the LAST day we saw in that month.
    const monthlyByChain = new Map<string, Map<string, number>>();
    for (const [chain, val] of Object.entries(chainTvls)) {
      if (chain.includes("-")) continue;
      const series = val?.tvl || [];
      const inner = new Map<string, number>();
      for (const point of series) {
        const d = new Date(Number(point.date) * 1000);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        inner.set(key, Number(point.totalLiquidityUSD || 0)); // overwrite => last day wins
      }
      monthlyByChain.set(chain, inner);
    }
    // Sum across chains per month
    const totalByMonth = new Map<string, number>();
    for (const inner of monthlyByChain.values()) {
      for (const [k, v] of inner) totalByMonth.set(k, (totalByMonth.get(k) || 0) + v);
    }
    // Build array oldest → newest for the last `months` months
    const out: number[] = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      out.push(totalByMonth.get(key) || 0);
    }
    return out;
  } catch {
    return new Array(months).fill(0);
  }
}

export async function fetchLlamaProtocol(slug: string): Promise<{ tvl: number | null; change24h: number | null }> {
  try {
    const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
    if (!r.ok) return { tvl: null, change24h: null };
    const data = await r.json();
    const current: Record<string, number> = data.currentChainTvls || {};
    const chainTvls: Record<string, { tvl?: { date: number; totalLiquidityUSD: number }[] }> = data.chainTvls || {};
    let curTotal = 0;
    let prevTotal = 0;
    for (const [chain, val] of Object.entries(current)) {
      if (chain.includes("-")) continue; // skip staking/borrowed/pool2 sub buckets
      curTotal += Number(val) || 0;
      const series = chainTvls[chain]?.tvl;
      if (series && series.length >= 2) {
        prevTotal += Number(series[series.length - 2].totalLiquidityUSD) || 0;
      } else if (series && series.length === 1) {
        prevTotal += Number(series[0].totalLiquidityUSD) || 0;
      }
    }
    const change = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : null;
    return { tvl: curTotal || null, change24h: change };
  } catch {
    return { tvl: null, change24h: null };
  }
}
