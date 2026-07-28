import { useState } from "react";
import { brandLogoUrl } from "@/lib/brandLogo";

type Props = {
  logo: string | null | undefined;
  url?: string | null | undefined;
  name: string;
  className?: string;
};

export function CompanyLogo({ logo, url, name, className = "w-7 h-7 rounded-md" }: Props) {
  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  const [failed, setFailed] = useState(false);

  const src = !failed ? (logo || brandLogoUrl(name, url)) : null;

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
      onError={() => setFailed(true)}
    />
  );
}
