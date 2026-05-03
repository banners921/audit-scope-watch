# AuditScope — Phase 1 Build Plan

A dark, data-forward B2B SaaS for protocol security intelligence. Connects to the existing Supabase project at `qktjbtmcjrwzmtqnszbq.supabase.co` and reads from `protocols`, `audit_history`, `signal_alerts`. Creates only one new table: `user_alerts`.

## Brand & Design System

- Background `#080B14`, cards `#0F1420`, border subtle gray
- Accent teal `#22D3EE` → blue `#2563EB` gradient (logo + CTAs only)
- Risk colors: red `#EF4444`, amber `#F59E0B`, green `#10B981`
- Text white, secondary `#A0A8B8`
- Fonts: Inter (UI), JetBrains Mono (numbers/scores/TVL)
- 16px rounded cards, generous padding, no background gradients
- All tokens defined in `index.css` + `tailwind.config.ts` as semantic HSL variables

Logo: rounded-square crosshair node (concentric circle + center dot, teal→blue gradient) next to "AuditScope" wordmark.

## Auth & Supabase

- Connect existing Supabase project via Supabase integration (URL provided)
- Email/password signup + login at `/login`, `/signup`
- `useAuth` hook wraps `onAuthStateChange` then `getSession`
- All app routes protected; unauth → `/login`
- No `profiles` table created — we use `auth.users` only (display name pulled from user metadata)

## App Shell / Navigation

- `SidebarProvider` shell with `collapsible="icon"` left sidebar
- Sidebar items: Dashboard, Protocols, Alerts, Profile (lucide icons + labels)
- Top bar: AuditScope logo (left), user email + avatar dropdown (right) with Sign Out

## Pages

### 1. `/login` and `/signup`
Standard Supabase email/password forms, dark themed, branded.

### 2. `/dashboard`
- Four stat cards (mono numerals):
  - Protocols Tracked — `count(*)` from protocols
  - High Risk — `security_score >= 70` count
  - Unaudited with TVL — `last_audit_date IS NULL AND tvl_usd >= 500000`
  - Have Bug Bounty — `has_bug_bounty = true` count
- Recent Signal Alerts table (latest 10, joined to protocol name): protocol, alert_type, severity badge, fired_at
- Top 5 highest `security_score` protocols as cards (logo, name, score gauge mini)

### 3. `/protocols` (core page)
- Search input (by name, debounced)
- Filters: category dropdown, chain multi-select, min TVL number, has bug bounty toggle, has been hacked toggle, audit status (never / stale >12mo / recent ≤12mo)
- Sortable table columns: Logo+Name, Category, TVL ($ formatted), 7d % (green/red), Security Score colored badge (red ≥70, amber 40–69, green <40), Last Audit, Bug Bounty yes/no
- Default sort: `security_score DESC`
- Row click → `/protocols/[slug]`
- Server-side query via Supabase with filters/sort; pagination (50/page)

### 4. `/protocols/[slug]` (detail)
Header: logo, name, category, chains as tags, TVL big mono number with 7d change, large circular security score gauge (color-coded), website / twitter / github icon links.

Grid below (2×2):
- AUDIT HISTORY — table from `audit_history` filtered by slug (Firm, Date, Type, Report link); red banner "Never audited" if empty
- HACK HISTORY — green "No known exploits" or amber warning with hack count
- BUG BOUNTY — red "No bug bounty program" or amount + link
- SIGNAL ALERTS — recent alerts for this slug (alert_type, severity, fired_at)

### 5. `/alerts`
- New `user_alerts` table (created via migration)
- List user's saved alerts with on/off toggle and delete
- Create alert form: name, category multi-select, min TVL, security score threshold slider, trigger (TVL spike / stale audit / new hack / no bug bounty), delivery (Slack webhook URL or Telegram chat ID)
- This phase stores config only; firing logic is out of scope

### 6. `/profile`
- Display name + email (from auth)
- Notification prefs: Slack webhook, Telegram chat ID (stored in user metadata)
- Billing placeholder: "Stripe coming soon"
- Sign out

## Database Work (only new schema)

New table `public.user_alerts`:

```text
id uuid pk default gen_random_uuid()
user_id uuid references auth.users(id) on delete cascade not null
name text not null
categories text[] default '{}'
min_tvl numeric default 0
score_threshold int default 0
trigger text check (trigger in ('tvl_spike','stale_audit','new_hack','no_bug_bounty'))
delivery_type text check (delivery_type in ('slack','telegram'))
delivery_target text not null
enabled bool default true
created_at timestamptz default now()
```

RLS enabled. Policies: user can `select/insert/update/delete` rows where `user_id = auth.uid()`.

No changes to existing `protocols`, `audit_history`, `signal_alerts` tables. We assume they are already RLS-readable to authenticated users; if reads return empty I'll add read policies.

## Technical Notes

- React Router routes added in `App.tsx` with a `ProtectedLayout` wrapping app shell
- Supabase queries via `@tanstack/react-query` for caching and loading states
- Reusable components: `StatCard`, `SecurityScoreBadge`, `ScoreGauge`, `TvlChange`, `SeverityBadge`, `ProtocolLogo`
- Helpers: `formatTvl`, `formatPct`, `auditStatus(date)`
- All tables use shadcn `Table`; filters use shadcn `Select`, `Input`, `Switch`, `Slider`
- Numeric values wrapped in `font-mono` (JetBrains Mono via Google Fonts in `index.html`)

## Out of Scope (Phase 1)

- Landing page
- Stripe billing (placeholder only)
- Actual alert delivery / cron firing
- Admin tools, team seats
