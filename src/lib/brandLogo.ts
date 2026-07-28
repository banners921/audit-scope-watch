// Brand logo helper — given a company/firm name, return a Brandfetch CDN URL.
// Brandfetch CDN: https://cdn.brandfetch.io/{domain} — free, no auth, returns the brand's logo.

// Hand-curated name→domain map for entities we don't store URLs for (audit firms, funds).
// Keys are lowercased + trimmed. Add freely.
const NAME_TO_DOMAIN: Record<string, string> = {
  // ===== Audit firms =====
  "trail of bits": "trailofbits.com",
  "openzeppelin": "openzeppelin.com",
  "consensys diligence": "consensys.io",
  "halborn": "halborn.com",
  "sherlock": "sherlock.xyz",
  "spearbit": "spearbit.com",
  "cantina": "cantina.xyz",
  "code4rena": "code4rena.com",
  "hacken": "hacken.io",
  "quantstamp": "quantstamp.com",
  "certik": "certik.com",
  "chainsecurity": "chainsecurity.com",
  "sigma prime": "sigmaprime.io",
  "mixbytes": "mixbytes.io",
  "cyfrin": "cyfrin.io",
  "zellic": "zellic.io",
  "blocksec": "blocksec.com",
  "verichains": "verichains.io",
  "three sigma": "three-sigma.xyz",
  "dedaub": "dedaub.com",
  "coinspect": "coinspect.com",
  "pashov audit group": "pashov.net",
  "veridise": "veridise.com",
  "slowmist": "slowmist.com",
  "peckshield": "peckshield.com",
  "certora": "certora.com",
  "abdk consulting": "abdk.consulting",
  "pessimistic": "pessimistic.io",
  "yaudit": "yaudit.dev",
  "ottersec": "osec.io",
  "macro": "0xmacro.com",
  "runtime verification": "runtimeverification.com",
  "least authority": "leastauthority.com",
  "ackee blockchain": "ackee.xyz",
  "nethermind": "nethermind.io",
  "consensys": "consensys.io",
  "statemind": "statemind.io",
  "blackthorn": "blackthorn.xyz",
  "savant": "savant.so",
  "stermi": "stermi.xyz",
  "salus security": "salusec.io",

  // ===== Funds / VCs =====
  "a16z": "a16z.com",
  "andreessen horowitz": "a16z.com",
  "a16z crypto": "a16z.com",
  "paradigm": "paradigm.xyz",
  "multicoin": "multicoin.capital",
  "multicoin capital": "multicoin.capital",
  "pantera": "panteracapital.com",
  "pantera capital": "panteracapital.com",
  "coinbase ventures": "ventures.coinbase.com",
  "coinbase": "coinbase.com",
  "polychain": "polychain.capital",
  "polychain capital": "polychain.capital",
  "variant": "variant.fund",
  "variant fund": "variant.fund",
  "dcg": "dcg.co",
  "digital currency group": "dcg.co",
  "dragonfly": "dragonfly.xyz",
  "dragonfly capital": "dragonfly.xyz",
  "hashed": "hashed.com",
  "galaxy": "galaxy.com",
  "galaxy digital": "galaxy.com",
  "sequoia": "sequoiacap.com",
  "sequoia capital": "sequoiacap.com",
  "tiger global": "tigerglobal.com",
  "lightspeed": "lsvp.com",
  "lightspeed venture partners": "lsvp.com",
  "founders fund": "foundersfund.com",
  "thiel capital": "thielcapital.com",
  "ribbit": "ribbitcap.com",
  "ribbit capital": "ribbitcap.com",
  "framework": "framework.ventures",
  "framework ventures": "framework.ventures",
  "1confirmation": "1confirmation.com",
  "delphi": "delphidigital.io",
  "delphi ventures": "delphidigital.io",
  "delphi digital": "delphidigital.io",
  "haun ventures": "haun.co",
  "lemniscap": "lemniscap.com",
  "electric capital": "electriccapital.com",
  "blockchain capital": "blockchain.capital",
  "fenbushi": "fenbushi.vc",
  "fenbushi capital": "fenbushi.vc",
  "iosg": "iosg.vc",
  "iosg ventures": "iosg.vc",
  "binance labs": "labs.binance.com",
  "binance": "binance.com",
  "yzi labs": "yzilabs.com",
  "spartan group": "spartangroup.io",
  "spartan capital": "spartangroup.io",
  "kraken ventures": "krakenventures.com",
  "okx ventures": "okx.com",
  "robot ventures": "robot.ventures",
  "naval ravikant": "navalravikant.com",
  "balaji srinivasan": "balajis.com",
  "jane street": "janestreet.com",
  "jump crypto": "jumpcrypto.com",
  "jump trading": "jumptrading.com",
  "gsr": "gsr.io",
  "wintermute": "wintermute.com",
  "amber group": "ambergroup.io",
  "circle ventures": "circle.com",
  "ripple": "ripple.com",
  "vista equity": "vistaequitypartners.com",
};

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function slugifyName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Resolve a probable domain for a brand name. Priority:
 *   1. Curated NAME_TO_DOMAIN map
 *   2. Caller-provided URL (extract host)
 *   3. Heuristic: slug.com (often wrong but quick) — only as last resort if `guessDomain` is true
 */
export function brandDomain(name: string | null | undefined, hintUrl?: string | null, guessDomain = false): string | null {
  if (!name) return hintUrl ? extractDomain(hintUrl) : null;
  const key = name.trim().toLowerCase();
  if (NAME_TO_DOMAIN[key]) return NAME_TO_DOMAIN[key];
  // Try stripping common suffixes
  const stripped = key.replace(/\s+(group|capital|ventures|partners|fund|labs|llc|inc\.?|ltd\.?)$/i, "").trim();
  if (NAME_TO_DOMAIN[stripped]) return NAME_TO_DOMAIN[stripped];
  if (hintUrl) {
    const d = extractDomain(hintUrl);
    if (d) return d;
  }
  if (guessDomain) {
    const slug = slugifyName(name);
    if (slug) return `${slug}.com`;
  }
  return null;
}

/**
 * Whether the brand is "confirmed" for Brandfetch — i.e. exists in our curated
 * NAME_TO_DOMAIN map. A website URL alone is NOT enough: Brandfetch returns its
 * generic "B" placeholder (200 OK) for unknown domains, which looks broken.
 */
export function brandDomainConfirmed(name: string | null | undefined, _hintUrl?: string | null): boolean {
  if (!name) return false;
  const key = name.trim().toLowerCase();
  if (NAME_TO_DOMAIN[key]) return true;
  const stripped = key.replace(/\s+(group|capital|ventures|partners|fund|labs|llc|inc\.?|ltd\.?)$/i, "").trim();
  if (NAME_TO_DOMAIN[stripped]) return true;
  return false;
}

/**
 * Build a Brandfetch CDN URL — only when the domain is *confirmed* (curated or
 * from a real company URL). For guessed-from-slug domains, returns null so
 * callers can fall back to a letter chip instead of Brandfetch's "B" placeholder.
 */
export function brandLogoUrl(name: string | null | undefined, hintUrl?: string | null, guessDomain = false): string | null {
  if (!brandDomainConfirmed(name, hintUrl)) return null;
  const d = brandDomain(name, hintUrl, guessDomain);
  return d ? `https://cdn.brandfetch.io/${d}` : null;
}
