// Canonical category taxonomy — shared by Companies, Funding Rounds, Fund Dashboard, Analytics.
// Preserves 8 DefiLlama categories per policy: Lending, Yield, Derivatives, CDP,
// Bridge, Liquid Staking, Insurance, Privacy, Stablecoin. Web3leads-flavored for the rest.

export function canonicalCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase().trim().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (!k) return null;
  if (k === "dex" || k === "dexs" || k === "spot dex" || k.includes("decentralised trading") || k.includes("decentralized trading")) return "DEX";
  if (k.includes("dex aggregator") || k === "aggregator") return "DEX Aggregator";
  if (k === "defi") return "DeFi";
  if (k === "lending" || k === "lending market" || k === "money market") return "Lending";
  if (k === "bridge" || k === "bridges" || k.includes("cross chain") || k.includes("crosschain")) return "Bridge";
  if (k === "yield" || k === "yield aggregator" || k === "yield farming" || k === "vaults") return "Yield";
  if (k === "liquid staking" || k === "lsd") return "Liquid Staking";
  if (k === "staking" || k === "restaking" || k === "re staking" || k.includes("eigenlayer")) return "Restaking";
  if (k === "derivatives" || k === "perpetuals" || k === "perps" || k.includes("perp ")) return "Derivatives";
  if (k === "options") return "Options";
  if (k === "cdp" || k.includes("collateralized debt") || k.includes("collateralised debt")) return "CDP";
  if (k === "stablecoin" || k === "stablecoins" || k === "algorithmic stablecoin") return "Stablecoin";
  if (k === "insurance" || k === "coverage") return "Insurance";
  if (k === "privacy" || k === "zero knowledge" || k === "zk" || k.includes("anonymity")) return "Privacy";
  if (k === "l1" || k.includes("layer 1") || k === "blockchain") return "L1";
  if (k === "l2" || k.includes("layer 2") || k === "rollup" || k.includes("rollups") || k.includes("optimistic") || k.includes("zk rollup")) return "L2";
  if (k === "infrastructure" || k === "infra" || k === "node infrastructure") return "Infrastructure";
  if (k === "tools" || k === "tooling" || k.includes("developer tool") || k === "interfaces and tools" || k === "interfaces & tools" || k === "sdk") return "Tools";
  if (k === "nft" || k === "nfts" || k === "collectible" || k === "collectibles" || k.includes("nft marketplace")) return "NFT";
  if (k === "gaming" || k === "game" || k === "games" || k.includes("gamefi") || k === "play to earn") return "Gaming";
  if (k === "rwa" || k.includes("real world asset") || k.includes("real-world asset") || k.includes("tokenization") || k.includes("tokenisation")) return "RWA";
  if (k === "cex" || k === "exchange" || k === "centralized exchange" || k === "centralised exchange") return "CEX";
  if (k === "wallet" || k === "wallets" || k === "self custody wallet") return "Wallet";
  if (k === "ai" || k === "artificial intelligence" || k === "machine learning" || k === "ai agents") return "AI";
  if (k === "depin" || k.includes("decentralized physical") || k.includes("decentralised physical")) return "DePIN";
  if (k === "social" || k.includes("social platform") || k === "social & consumer" || k === "consumer") return "Social";
  if (k === "prediction market" || k.includes("prediction markets") || k === "betting") return "Prediction Market";
  if (k === "payments" || k === "payment" || k === "remittance") return "Payments";
  if (k.includes("launchpad") || k === "ido" || k === "ico" || k === "ieo") return "Launchpad";
  if (k === "trading" || k === "orderbook" || k === "amm" || k === "spot trading") return "Trading";
  if (k === "analytics" || k.includes("data analytics") || k === "data") return "Analytics";
  if (k === "security" || k === "audit" || k.includes("monitoring") || k === "auditing") return "Security";
  if (k === "custody" || k === "treasury" || k === "treasury management") return "Custody";
  if (k === "web3" || k === "web 3") return "Web3";
  if (k === "ce fi" || k === "cefi") return "CeFi";
  if (k === "hardware" || k === "hardware wallet") return "Hardware";
  if (k === "treasury company") return "Treasury Company";
  return raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const CATEGORY_PALETTE = [
  "text-cyan-300", "text-emerald-300", "text-violet-300", "text-pink-300", "text-amber-300",
  "text-sky-300", "text-rose-300", "text-fuchsia-300", "text-teal-300", "text-orange-300",
  "text-indigo-300", "text-yellow-300", "text-blue-300", "text-green-300", "text-purple-300",
];

export function categoryTextColor(category: string | null | undefined): string {
  if (!category) return "text-muted-foreground";
  const k = category.toLowerCase();
  if (/^defi\b|^lending\b|^yield\b|^cdp\b|^stablecoin\b/.test(k)) return "text-emerald-300";
  if (/^dex\b|trading|orderbook|amm/.test(k)) return "text-cyan-300";
  if (/^bridge\b|cross.?chain/.test(k)) return "text-orange-300";
  if (/^l1\b|^l2\b|^chain\b|rollup/.test(k)) return "text-violet-300";
  if (/infrastructure|tooling|developer|sdk/.test(k)) return "text-sky-300";
  if (/^nft\b|collectible/.test(k)) return "text-pink-300";
  if (/^gaming\b|game/.test(k)) return "text-fuchsia-300";
  if (/^rwa\b|real.?world|tokeniz/.test(k)) return "text-amber-300";
  if (/^cex\b|exchange/.test(k)) return "text-blue-300";
  if (/^derivative|perp|futures|options/.test(k)) return "text-rose-300";
  if (/staking|restaking|liquid.?staking/.test(k)) return "text-teal-300";
  if (/privacy|zk\b|zero.?knowledge/.test(k)) return "text-indigo-300";
  if (/insurance|coverage/.test(k)) return "text-yellow-300";
  if (/social|consumer|community/.test(k)) return "text-purple-300";
  if (/security|audit|monitoring/.test(k)) return "text-emerald-300";
  if (/payment|payroll|remit/.test(k)) return "text-green-300";
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return CATEGORY_PALETTE[Math.abs(h) % CATEGORY_PALETTE.length];
}
