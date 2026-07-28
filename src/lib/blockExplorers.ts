// Map chain slug → block explorer URL builder.
const EXPLORERS: Record<string, (addr: string) => string> = {
  ethereum: (a) => `https://etherscan.io/address/${a}`,
  arbitrum: (a) => `https://arbiscan.io/address/${a}`,
  optimism: (a) => `https://optimistic.etherscan.io/address/${a}`,
  polygon: (a) => `https://polygonscan.com/address/${a}`,
  "polygon-pos": (a) => `https://polygonscan.com/address/${a}`,
  "polygon-zkevm": (a) => `https://zkevm.polygonscan.com/address/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  bsc: (a) => `https://bscscan.com/address/${a}`,
  "binance-smart-chain": (a) => `https://bscscan.com/address/${a}`,
  avalanche: (a) => `https://snowtrace.io/address/${a}`,
  "avalanche-c-chain": (a) => `https://snowtrace.io/address/${a}`,
  fantom: (a) => `https://ftmscan.com/address/${a}`,
  gnosis: (a) => `https://gnosisscan.io/address/${a}`,
  xdai: (a) => `https://gnosisscan.io/address/${a}`,
  celo: (a) => `https://celoscan.io/address/${a}`,
  solana: (a) => `https://solscan.io/account/${a}`,
  berachain: (a) => `https://berascan.com/address/${a}`,
  blast: (a) => `https://blastscan.io/address/${a}`,
  linea: (a) => `https://lineascan.build/address/${a}`,
  scroll: (a) => `https://scrollscan.com/address/${a}`,
  sonic: (a) => `https://sonicscan.org/address/${a}`,
  hyperliquid: (a) => `https://app.hyperliquid.xyz/explorer/address/${a}`,
  zksync: (a) => `https://explorer.zksync.io/address/${a}`,
  "zksync-era": (a) => `https://explorer.zksync.io/address/${a}`,
  mantle: (a) => `https://mantlescan.xyz/address/${a}`,
  moonbeam: (a) => `https://moonscan.io/address/${a}`,
  fraxtal: (a) => `https://fraxscan.com/address/${a}`,
  manta: (a) => `https://pacific-explorer.manta.network/address/${a}`,
  metis: (a) => `https://explorer.metis.io/address/${a}`,
  mode: (a) => `https://explorer.mode.network/address/${a}`,
  zora: (a) => `https://explorer.zora.energy/address/${a}`,
  "world-chain": (a) => `https://worldchain-mainnet.explorer.alchemy.com/address/${a}`,
  worldchain: (a) => `https://worldchain-mainnet.explorer.alchemy.com/address/${a}`,
  aptos: (a) => `https://aptoscan.com/account/${a}`,
  sui: (a) => `https://suivision.xyz/account/${a}`,
  near: (a) => `https://nearblocks.io/address/${a}`,
  ton: (a) => `https://tonviewer.com/${a}`,
  tron: (a) => `https://tronscan.org/#/address/${a}`,
};

export function explorerUrl(chain: string | null | undefined, address: string | null | undefined): string | null {
  if (!chain || !address) return null;
  const key = chain.toLowerCase().trim();
  const builder = EXPLORERS[key];
  if (!builder) return null;
  return builder(address);
}

export function explorerName(chain: string | null | undefined): string {
  const c = (chain || "").toLowerCase();
  if (c.includes("solana")) return "Solscan";
  if (c.includes("aptos")) return "Aptoscan";
  if (c.includes("sui")) return "SuiVision";
  if (c === "ethereum") return "Etherscan";
  if (c === "arbitrum") return "Arbiscan";
  if (c === "optimism") return "Optimistic Etherscan";
  if (c.startsWith("polygon")) return "Polygonscan";
  if (c === "base") return "Basescan";
  if (c === "bsc" || c.includes("binance")) return "BscScan";
  if (c.includes("avalanche")) return "Snowtrace";
  if (c === "fantom") return "FtmScan";
  if (c === "gnosis" || c === "xdai") return "GnosisScan";
  if (c === "celo") return "CeloScan";
  return "Explorer";
}
