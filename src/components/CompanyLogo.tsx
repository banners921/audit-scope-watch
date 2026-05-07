import { useState } from "react";

type Props = {
  logo: string | null | undefined;
  url?: string | null | undefined;
  name: string;
  className?: string;
};

export function CompanyLogo({ logo, name, className = "w-7 h-7 rounded-md" }: Props) {
  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  const [failed, setFailed] = useState(false);

  if (!logo || failed) {
    return (
      <div className={`${className} bg-white/5 flex items-center justify-center text-muted-foreground font-semibold`}>
        {initial}
      </div>
    );
  }

  return (
    <img
      src={logo}
      alt=""
      className={`${className} bg-white/5 object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
