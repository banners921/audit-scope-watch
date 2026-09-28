import { useState } from "react";
import { ShieldCheck } from "lucide-react";

/**
 * The mark shown on an audit card.
 *
 * The shield is the default, not the error state. A logo renders ONLY when the
 * caller passes one it already resolved from companies.logo via a verified
 * company_slug. This component never looks a logo up, and deliberately takes no
 * name, title, filename or URL to derive one from: a logo guessed from an audit
 * title or display name would put a real company's mark on the wrong audit,
 * which is worse than showing no logo at all.
 *
 * If the image 404s or is blocked at render time, it falls back to the shield
 * rather than leaving a broken image in the card header.
 */
export function AuditCardMark({ logo }: { logo?: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!logo || failed) {
    return <ShieldCheck className="w-3 h-3 text-primary shrink-0" aria-hidden />;
  }

  return (
    <img
      src={logo}
      alt=""
      loading="lazy"
      aria-hidden
      className="w-3.5 h-3.5 rounded-sm object-contain bg-white/5 shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
