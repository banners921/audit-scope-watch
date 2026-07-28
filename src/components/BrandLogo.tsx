import { useState } from "react";
import { brandLogoUrl, brandDomain, brandDomainConfirmed } from "@/lib/brandLogo";

type Props = {
  name: string;
  url?: string | null;
  /** Pre-resolved logo URL (e.g., from a stored field). Takes priority over Brandfetch lookup. */
  logo?: string | null;
  className?: string;
  /** When true, also try {slug}.com as a last-resort guess. Default true now — coverage > false positives. */
  guessDomain?: boolean;
};

// Consistent color from name hash so a letter-fallback looks intentional, not "missing"
function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const palette = [
    "from-purple-500/30 to-purple-700/30 text-purple-200",
    "from-blue-500/30 to-blue-700/30 text-blue-200",
    "from-emerald-500/30 to-emerald-700/30 text-emerald-200",
    "from-amber-500/30 to-amber-700/30 text-amber-200",
    "from-rose-500/30 to-rose-700/30 text-rose-200",
    "from-cyan-500/30 to-cyan-700/30 text-cyan-200",
    "from-indigo-500/30 to-indigo-700/30 text-indigo-200",
    "from-pink-500/30 to-pink-700/30 text-pink-200",
    "from-teal-500/30 to-teal-700/30 text-teal-200",
    "from-fuchsia-500/30 to-fuchsia-700/30 text-fuchsia-200",
  ];
  return palette[Math.abs(h) % palette.length];
}

export function BrandLogo({ name, url, logo, className = "w-7 h-7 rounded-md", guessDomain = true }: Props) {
  const [failedPrimary, setFailedPrimary] = useState(false);
  const [failedFallback, setFailedFallback] = useState(false);

  // Order:
  // 1. Caller-provided logo URL
  // 2. Brandfetch — ONLY for confirmed domains (curated map or company.url),
  //    never for guessed slug.com domains (Brandfetch returns a "B" placeholder)
  // 3. Google favicon if any domain (real 404 on unknown)
  // 4. Colored letter chip
  const confirmed = brandDomainConfirmed(name, url);
  const primary = !failedPrimary
    ? (logo || (confirmed ? brandLogoUrl(name, url, false) : null))
    : null;
  const domain = brandDomain(name, url, guessDomain);
  const fallback = !failedFallback && domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;

  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  const colors = colorFromName(name || "?");

  if (!primary && !fallback) {
    // No logo source available — colored letter chip
    return (
      <div className={`${className} bg-gradient-to-br ${colors} border border-white/10 flex items-center justify-center font-bold text-sm`}>
        {initial}
      </div>
    );
  }

  if (primary && !failedPrimary) {
    return (
      <img
        src={primary}
        alt=""
        className={`${className} bg-white object-cover`}
        onError={() => setFailedPrimary(true)}
      />
    );
  }

  if (fallback && !failedFallback) {
    return (
      <img
        src={fallback}
        alt=""
        className={`${className} bg-white object-cover`}
        onError={() => setFailedFallback(true)}
      />
    );
  }

  // Both failed → colored letter chip
  return (
    <div className={`${className} bg-gradient-to-br ${colors} border border-white/10 flex items-center justify-center font-bold text-sm`}>
      {initial}
    </div>
  );
}
