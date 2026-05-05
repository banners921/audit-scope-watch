import { useState } from "react";

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function clearbitLogo(url: string | null | undefined): string | null {
  const d = extractDomain(url);
  return d ? `https://logo.clearbit.com/${d}` : null;
}

type Props = {
  logo: string | null | undefined;
  url: string | null | undefined;
  name: string;
  className?: string;
};

export function CompanyLogo({ logo, url, name, className = "w-7 h-7 rounded-md" }: Props) {
  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  const fallbackChain: string[] = [];
  if (logo) fallbackChain.push(logo);
  const cb = clearbitLogo(url);
  if (cb) fallbackChain.push(cb);

  const [idx, setIdx] = useState(0);
  const src = fallbackChain[idx];

  if (!src) {
    return (
      <div className={`${className} bg-white/5 flex items-center justify-center text-muted-foreground font-semibold`}>
        {initial}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`${className} bg-white/5 object-contain`}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
