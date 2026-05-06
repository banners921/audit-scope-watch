import { useState, useEffect, CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

type ThemeName = "dark" | "light";

const T = {
  dark: {
    bg: "#080B14",
    bgRaised: "#0F1420",
    bgCard: "#101626",
    border: "#ffffff10",
    borderStrong: "#ffffff1f",
    text: "#FFFFFF",
    textDim: "#A0A8B8",
    textMute: "#6B7385",
    accent: "#22D3EE",
    accentDeep: "#2563EB",
    accentText: "#67E8F9",
    pill: "#0F1420",
    danger: "#F59E0B",
  },
  light: {
    bg: "#F7F9FC",
    bgRaised: "#FFFFFF",
    bgCard: "#FFFFFF",
    border: "#0a0e1a14",
    borderStrong: "#0a0e1a26",
    text: "#0A0F1C",
    textDim: "#475569",
    textMute: "#94A3B8",
    accent: "#0891B2",
    accentDeep: "#1E40AF",
    accentText: "#0E7490",
    pill: "#F1F5F9",
    danger: "#D97706",
  },
};

const G_BTN = (theme: ThemeName) =>
  `linear-gradient(180deg, ${theme === "dark" ? "#22D3EE" : "#06B6D4"} 0%, ${
    theme === "dark" ? "#2563EB" : "#0891B2"
  } 100%)`;

function Logo({ size = 64 }: { size?: number }) {
  return (
    <img
      src="/auditscope-icon.png"
      width={size}
      height={size}
      alt="AuditScope"
      style={{ display: "block", width: size, height: size }}
    />
  );
}

function ThemeToggle({
  theme,
  setTheme,
}: {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}) {
  const t = T[theme];
  return (
    <div
      style={{
        background: t.bgRaised,
        border: `1px solid ${t.borderStrong}`,
        borderRadius: 999,
        padding: 4,
        display: "flex",
        gap: 2,
      }}
    >
      {(["dark", "light"] as ThemeName[]).map((m) => (
        <button
          key={m}
          onClick={() => setTheme(m)}
          style={{
            background:
              theme === m
                ? m === "dark"
                  ? "#22D3EE22"
                  : "#0891B222"
                : "transparent",
            color: theme === m ? t.accentText : t.textDim,
            border: "none",
            padding: "6px 14px",
            borderRadius: 999,
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textTransform: "capitalize",
          }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function Nav({
  theme,
  setTheme,
  onSignIn,
  onGetStarted,
  onScroll,
}: {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
  onScroll: (id: string) => void;
}) {
  const t = T[theme];
  const navLink: CSSProperties = {
    fontFamily: "Inter, sans-serif",
    fontSize: 14,
    color: t.textDim,
    textDecoration: "none",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
  };
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 48px",
        borderBottom: `1px solid ${t.border}`,
        position: "relative",
        zIndex: 10,
        background:
          theme === "dark" ? "rgba(8,11,20,0.6)" : "rgba(247,249,252,0.6)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <Logo size={64} />
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 18,
            color: t.text,
            letterSpacing: "-0.02em",
          }}
        >
          AuditScope
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <button style={navLink} onClick={() => onScroll("features")}>
          Features
        </button>
        <button style={navLink} onClick={() => onScroll("pricing")}>
          Pricing
        </button>
        <button style={navLink} onClick={onSignIn}>
          Sign in
        </button>
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <button
          onClick={onGetStarted}
          style={{
            background: G_BTN(theme),
            color: "#fff",
            border: "none",
            padding: "9px 18px",
            borderRadius: 999,
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            boxShadow:
              theme === "dark"
                ? "0 0 20px #22D3EE55"
                : "0 4px 14px rgba(8,145,178,0.3)",
          }}
        >
          Get Started
        </button>
      </div>
    </nav>
  );
}

function Hero({
  theme,
  onGetStarted,
}: {
  theme: ThemeName;
  onGetStarted: () => void;
}) {
  const t = T[theme];
  const glow =
    theme === "dark"
      ? "radial-gradient(ellipse 60% 70% at 50% 45%, #1E40AF66 0%, #2563EB22 30%, transparent 65%)"
      : "radial-gradient(ellipse 70% 70% at 50% 45%, #06B6D422 0%, #2563EB18 30%, transparent 65%)";
  return (
    <section
      style={{
        position: "relative",
        padding: "120px 48px 140px",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: glow,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          maxWidth: 980,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: t.pill,
            border: `1px solid ${t.border}`,
            borderRadius: 999,
            padding: "6px 14px",
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
            color: t.textDim,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: t.accent,
              boxShadow: `0 0 8px ${t.accent}`,
            }}
          />
          Web3 Protocol Security Intelligence
        </div>
        <h1
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 76,
            letterSpacing: "-0.045em",
            lineHeight: 1.02,
            color: t.text,
            margin: 0,
            textWrap: "balance" as CSSProperties["textWrap"],
          }}
        >
          Know which protocols{" "}
          <span
            key={theme}
            style={{
              backgroundImage: `linear-gradient(180deg, #67E8F9 0%, ${t.accent} 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
              display: "inline-block",
            }}
          >
            to call.
          </span>
          <br />
          And exactly why.
        </h1>
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 19,
            color: t.textDim,
            maxWidth: 680,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          AuditScope tracks every web3 protocol's audit history, smart contract
          activity, TVL, and security signals — so you call the right targets at
          the exact right moment.
        </p>
        <button
          onClick={onGetStarted}
          style={{
            background: G_BTN(theme),
            color: "#fff",
            border: "none",
            padding: "16px 28px",
            borderRadius: 999,
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
            boxShadow:
              theme === "dark"
                ? `0 0 30px ${t.accent}55`
                : "0 4px 14px rgba(8,145,178,0.3)",
            marginTop: 8,
          }}
        >
          Get Full Access — $149/mo →
        </button>
        <div
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            color: t.textMute,
          }}
        >
          Free to cancel · No contracts
        </div>
      </div>
    </section>
  );
}

function StatsBar({ theme }: { theme: ThemeName }) {
  const t = T[theme];
  const items = [
    "3,600+ Protocols",
    "3,339 Funding Rounds",
    "1,354 VC Funds",
    "Updated Daily",
  ];
  return (
    <div
      style={{
        borderTop: `1px solid ${t.border}`,
        borderBottom: `1px solid ${t.border}`,
        padding: "18px 48px",
        display: "flex",
        justifyContent: "center",
        gap: 28,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 12,
        color: t.textDim,
        letterSpacing: "0.05em",
        flexWrap: "wrap",
      }}
    >
      {items.map((i, idx) => (
        <span key={i} style={{ display: "flex", gap: 28 }}>
          {i}
          {idx < items.length - 1 && <span style={{ opacity: 0.4 }}>·</span>}
        </span>
      ))}
    </div>
  );
}

function SectionHead({
  theme,
  eyebrow,
  title,
}: {
  theme: ThemeName;
  eyebrow: string;
  title: string;
}) {
  const t = T[theme];
  return (
    <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          color: t.accentText,
          letterSpacing: "0.2em",
          marginBottom: 16,
        }}
      >
        {eyebrow}
      </div>
      <h2
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 800,
          fontSize: 48,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          color: t.text,
          margin: 0,
        }}
      >
        {title}
      </h2>
    </div>
  );
}

function Card({
  theme,
  title,
  body,
}: {
  theme: ThemeName;
  title: string;
  body: string;
}) {
  const t = T[theme];
  return (
    <div
      style={{
        background: t.bgCard,
        border: `1px solid ${t.border}`,
        borderRadius: 20,
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 700,
          fontSize: 18,
          color: t.text,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 15,
          color: t.textDim,
          lineHeight: 1.55,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function Problem({ theme }: { theme: ThemeName }) {
  return (
    <section style={{ padding: "100px 48px" }}>
      <SectionHead
        theme={theme}
        eyebrow="THE PROBLEM"
        title="You're calling protocols blind."
      />
      <div
        style={{
          maxWidth: 1100,
          margin: "60px auto 0",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 20,
        }}
      >
        <Card
          theme={theme}
          title="No audit visibility"
          body="You don't know whose last audit was 18 months ago. You don't know who deployed new contracts last week. You're calling random protocols hoping one needs you."
        />
        <Card
          theme={theme}
          title="Missing onchain signals"
          body="A protocol just deployed new smart contracts on two new chains. TVL spiked 300% in a week. You found out a month later when they announced a hack."
        />
        <Card
          theme={theme}
          title="No news layer"
          body="Protocol governance votes, team changes, exploit near-misses, bug bounty launches — these are buying signals. You have no way to track them at scale."
        />
      </div>
    </section>
  );
}

function HowItWorks({ theme }: { theme: ThemeName }) {
  return (
    <section style={{ padding: "100px 48px" }}>
      <SectionHead
        theme={theme}
        eyebrow="HOW IT WORKS"
        title="Three layers of protocol intelligence."
      />
      <div
        style={{
          maxWidth: 1100,
          margin: "60px auto 0",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 20,
        }}
      >
        <Card
          theme={theme}
          title="Every protocol. Monitored."
          body="We track smart contract deployments, onchain activity, TVL movements, audit history, hack exposure, bug bounty status, and protocol news across thousands of web3 protocols. Continuously."
        />
        <Card
          theme={theme}
          title="Signals surface automatically"
          body="When something changes — new contract deployed, TVL spikes, audit goes stale, exploit reported, funding announced — you get a Slack or Telegram alert with full context on why it matters."
        />
        <Card
          theme={theme}
          title="Call at exactly the right moment"
          body="Every protocol page shows the full signal stack: last audit firm and date, smart contract activity, recent news, TVL trend, and decision maker contacts. Know before you dial."
        />
      </div>
    </section>
  );
}

function Features({ theme }: { theme: ThemeName }) {
  return (
    <section id="features" style={{ padding: "100px 48px" }}>
      <SectionHead
        theme={theme}
        eyebrow="FEATURES"
        title="Built for security firms that sell."
      />
      <div
        style={{
          maxWidth: 1100,
          margin: "60px auto 0",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 20,
        }}
      >
        <Card
          theme={theme}
          title="Security Risk Scoring"
          body="Every protocol scored 1-100 based on audit staleness, smart contract activity, TVL exposure, hack history, and bug bounty gaps. Sort your entire prospect list by who needs security most urgently. Work the right targets first."
        />
        <Card
          theme={theme}
          title="Real-Time Signal Alerts"
          body="Slack and Telegram alerts fire when a protocol crosses your threshold. New smart contract deployed. TVL spike. Audit gone stale. Recent exploit or near-miss. Funding round closed. You get the signal with full context — not just a notification."
        />
        <Card
          theme={theme}
          title="Audit History Database"
          body="Know which protocols deployed new contracts last week without a follow-up audit. Know whose last audit was 18 months ago with $200M TVL. Call first."
        />
        <Card
          theme={theme}
          title="Onchain & TVL Intelligence"
          body="Track smart contract deployments, chain expansions, and TVL movements across thousands of protocols. New contracts without audits are your highest-urgency prospects. TVL spikes mean budget and risk just increased simultaneously."
        />
        <Card
          theme={theme}
          title="Protocol News & Signal Feed"
          body="Governance votes, team changes, exploit near-misses, bug bounty launches, funding rounds — the news layer that turns research into pipeline."
        />
        <Card
          theme={theme}
          title="Decision Maker Contacts"
          body="Founders, CTOs, security leads. Verified contacts for every protocol — so once the signal fires, you know exactly who to reach."
        />
      </div>
    </section>
  );
}

function WhoFor({ theme }: { theme: ThemeName }) {
  const t = T[theme];
  const groups = [
    {
      title: "Audit Firms",
      list: "Certik. Trail of Bits. Halborn. Spearbit.",
    },
    {
      title: "Bug Bounty Platforms",
      list: "Immunefi. Sherlock. Code4rena.",
    },
    {
      title: "Security Tooling",
      list: "Monitoring, formal verification, pre-audit tools.",
    },
  ];
  return (
    <section style={{ padding: "100px 48px" }}>
      <SectionHead theme={theme} eyebrow="WHO IT'S FOR" title="If you sell security to web3, this is your pipeline." />
      <div
        style={{
          maxWidth: 1100,
          margin: "60px auto 0",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        {groups.map((g) => (
          <div
            key={g.title}
            style={{
              background: t.bgCard,
              border: `1px solid ${t.border}`,
              borderRadius: 20,
              padding: 28,
            }}
          >
            <div
              style={{
                fontFamily: "Inter, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                color: t.text,
                letterSpacing: "-0.02em",
              }}
            >
              {g.title}
            </div>
            <div
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                color: t.accentText,
                letterSpacing: "0.02em",
                marginTop: 8,
              }}
            >
              {g.list}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing({
  theme,
  onGetStarted,
}: {
  theme: ThemeName;
  onGetStarted: () => void;
}) {
  const t = T[theme];
  const features = [
    "Full protocol database with security risk scoring",
    "Smart contract deployment monitoring",
    "Audit history — firm, date, report, staleness",
    "TVL tracking and spike alerts",
    "Onchain activity and chain expansion signals",
    "Protocol news and governance feed",
    "Hack history and exploit exposure data",
    "Bug bounty gap identification",
    "Decision maker contacts",
    "Real-time Slack + Telegram alerts",
    "3,339 funding rounds database",
    "1,354 VC fund portfolios",
  ];
  return (
    <section id="pricing" style={{ padding: "120px 48px", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            theme === "dark"
              ? `radial-gradient(ellipse 60% 60% at 50% 50%, ${t.accentDeep}33 0%, transparent 60%)`
              : `radial-gradient(ellipse 60% 60% at 50% 50%, ${t.accent}11 0%, transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <SectionHead
          theme={theme}
          eyebrow="PRICING"
          title="One plan. Everything included."
        />
        <div style={{ maxWidth: 520, margin: "60px auto 0" }}>
          <div
            style={{
              background: t.bgCard,
              border: `1px solid ${t.accent}55`,
              borderRadius: 24,
              padding: 40,
              boxShadow:
                theme === "dark"
                  ? `0 0 60px ${t.accent}33, inset 0 0 0 1px ${t.accent}22`
                  : "0 12px 40px rgba(8,145,178,0.15)",
            }}
          >
            <div
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                color: t.accentText,
                letterSpacing: "0.15em",
              }}
            >
              AUDITSCOPE PRO
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                marginTop: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 800,
                  fontSize: 64,
                  color: t.text,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                }}
              >
                $149
              </span>
              <span
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 18,
                  color: t.textDim,
                }}
              >
                / month
              </span>
            </div>
            <div
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 14,
                color: t.textMute,
                marginTop: 6,
              }}
            >
              Cancel anytime. No contracts.
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "28px 0",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {features.map((f) => (
                <li
                  key={f}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: "Inter, sans-serif",
                    fontSize: 14,
                    color: t.text,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={t.accent}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={onGetStarted}
              style={{
                width: "100%",
                background: G_BTN(theme),
                color: "#fff",
                border: "none",
                padding: 16,
                borderRadius: 999,
                fontFamily: "Inter, sans-serif",
                fontWeight: 600,
                fontSize: 16,
                cursor: "pointer",
                boxShadow:
                  theme === "dark"
                    ? `0 0 30px ${t.accent}55`
                    : "0 4px 14px rgba(8,145,178,0.3)",
              }}
            >
              Get Started — $149/mo →
            </button>
            <div
              style={{
                textAlign: "center",
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                color: t.textMute,
                marginTop: 14,
              }}
            >
              Questions?{" "}
              <a
                href="mailto:hello@auditscope.ai"
                style={{ color: t.accentText, textDecoration: "none" }}
              >
                hello@auditscope.ai
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ theme }: { theme: ThemeName }) {
  const t = T[theme];
  return (
    <footer
      style={{
        borderTop: `1px solid ${t.border}`,
        padding: "32px 48px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <Logo size={64} />
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 18,
            color: t.text,
          }}
        >
          AuditScope
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 20,
          fontFamily: "Inter, sans-serif",
          fontSize: 13,
          color: t.textMute,
          alignItems: "center",
        }}
      >
        <span>Privacy Policy</span>
        <span>·</span>
        <a
          href="mailto:hello@auditscope.ai"
          style={{ color: t.accentText, textDecoration: "none" }}
        >
          hello@auditscope.ai
        </a>
      </div>
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 13,
          color: t.textMute,
        }}
      >
        © 2026 AuditScope
      </div>
    </footer>
  );
}

export default function Landing() {
  const [theme, setTheme] = useState<ThemeName>("dark");
  const navigate = useNavigate();
  const t = T[theme];

  useEffect(() => {
    document.title = "AuditScope — Web3 Protocol Security Intelligence";
  }, []);

  const goSignup = () => navigate("/signup");
  const goLogin = () => navigate("/login");
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bg,
        color: t.text,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Nav
        theme={theme}
        setTheme={setTheme}
        onSignIn={goLogin}
        onGetStarted={goSignup}
        onScroll={scrollTo}
      />
      <Hero theme={theme} onGetStarted={goSignup} />
      <StatsBar theme={theme} />
      <Problem theme={theme} />
      <HowItWorks theme={theme} />
      <Features theme={theme} />
      <WhoFor theme={theme} />
      <Pricing theme={theme} onGetStarted={goSignup} />
      <Footer theme={theme} />
    </div>
  );
}
