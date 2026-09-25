import { Globe, Github, Linkedin, Send, MessageCircle, ExternalLink } from "lucide-react";

export type Socials = {
  homepage_url?: string | null;
  social_x?: string | null;
  social_github?: string | null;
  linkedin_url?: string | null;
  telegram_url?: string | null;
  discord_url?: string | null;
};

/**
 * Some rows store a bare handle ("trailofbits"), others a full URL. Normalise
 * both to an absolute href instead of blindly prefixing, which produced
 * "github.com/https://github.com/..." for the full-URL rows.
 */
function href(value: string, base: string): string {
  const v = value.trim().replace(/^@/, "");
  return /^https?:\/\//i.test(v) ? v : base + v;
}

function label(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/** Last path segment, for showing "@handle" rather than a long URL. */
function handle(value: string): string {
  const v = label(value);
  const parts = v.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : v;
}

const linkCls =
  "text-muted-foreground hover:text-white inline-flex items-center gap-1 transition-colors";

export function SocialLinks({ data, className = "" }: { data: Socials; className?: string }) {
  const { homepage_url, social_x, social_github, linkedin_url, telegram_url, discord_url } = data;
  const any =
    homepage_url || social_x || social_github || linkedin_url || telegram_url || discord_url;
  if (!any) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] ${className}`}>
      {homepage_url && (
        <a href={href(homepage_url, "https://")} target="_blank" rel="noopener noreferrer"
           className="text-primary hover:underline inline-flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          {label(homepage_url)}
          <ExternalLink className="w-3 h-3 opacity-60" />
        </a>
      )}
      {social_x && (
        <a href={href(social_x, "https://x.com/")} target="_blank" rel="noopener noreferrer"
           className={linkCls} title={`@${handle(social_x)} on X`}>
          <span className="font-bold">𝕏</span>
          <span>@{handle(social_x)}</span>
        </a>
      )}
      {social_github && (
        <a href={href(social_github, "https://github.com/")} target="_blank" rel="noopener noreferrer"
           className={linkCls} title={`${handle(social_github)} on GitHub`}>
          <Github className="w-3.5 h-3.5" />
          <span>{handle(social_github)}</span>
        </a>
      )}
      {linkedin_url && (
        <a href={href(linkedin_url, "https://www.linkedin.com/company/")} target="_blank" rel="noopener noreferrer"
           className={linkCls} title={`${handle(linkedin_url)} on LinkedIn`}>
          <Linkedin className="w-3.5 h-3.5" />
          <span>LinkedIn</span>
        </a>
      )}
      {telegram_url && (
        <a href={href(telegram_url, "https://t.me/")} target="_blank" rel="noopener noreferrer"
           className={linkCls} title={`${handle(telegram_url)} on Telegram`}>
          <Send className="w-3.5 h-3.5" />
          <span>Telegram</span>
        </a>
      )}
      {discord_url && (
        <a href={href(discord_url, "https://discord.gg/")} target="_blank" rel="noopener noreferrer"
           className={linkCls} title="Discord">
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Discord</span>
        </a>
      )}
    </div>
  );
}
