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
