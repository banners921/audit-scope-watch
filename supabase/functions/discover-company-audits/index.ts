// v2 — stricter audit-file detection: require firm name OR /audit/ path OR 'audit' in filename. Reject template/example/deployed/contract.md
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

const FIRM_TOKENS: Array<[string, string]> = [
  ['trailofbits', 'Trail of Bits'], ['trail-of-bits', 'Trail of Bits'], ['tob-', 'Trail of Bits'],
  ['openzeppelin', 'OpenZeppelin'], ['oz-', 'OpenZeppelin'],
  ['spearbit', 'Spearbit'], ['cyfrin', 'Cyfrin'], ['chainsafe', 'ChainSafe'],
  ['certora', 'Certora'], ['halborn', 'Halborn'], ['quantstamp', 'Quantstamp'],
  ['certik', 'CertiK'], ['hacken', 'Hacken'], ['immunefi', 'Immunefi'],
  ['peckshield', 'PeckShield'], ['slowmist', 'SlowMist'], ['code4rena', 'Code4rena'],
  ['code-423n4', 'Code4rena'], ['sherlock', 'Sherlock'], ['cantina', 'Cantina'],
  ['mixbytes', 'MixBytes'], ['veridise', 'Veridise'], ['oak-security', 'Oak Security'],
  ['oak_security', 'Oak Security'], ['ottersec', 'OtterSec'], ['zellic', 'Zellic'],
  ['ackee', 'Ackee Blockchain'], ['runtime-verification', 'Runtime Verification'],
  ['nethermind', 'Nethermind'], ['hashlock', 'Hashlock'], ['consensys', 'ConsenSys Diligence'],
  ['salus', 'Salus Security'], ['hexens', 'Hexens'], ['threesigma', 'Three Sigma'],
  ['three-sigma', 'Three Sigma'], ['cobtreasure', 'Cobtreasure'], ['decurity', 'Decurity'],
  ['blocksec', 'BlockSec'], ['secure3', 'Secure3'], ['cyberscope', 'Cyberscope'],
  ['shieldify', 'Shieldify Security'], ['vulsight', 'VulSight'], ['vibranium', 'Vibranium Audits'],
  ['offside-labs', 'Offside Labs'], ['kalos', 'Kalos'], ['iosiro', 'iosiro'],
  ['sec3', 'Sec3'], ['imm', 'ImmuneBytes'], ['immunebytes', 'ImmuneBytes'], ['verichains', 'Verichains'],
  ['trust-security', 'Trust Security'], ['bramah', 'Bramah Systems'], ['movebit', 'Movebit'],
  ['ottersec', 'OtterSec'], ['guvenkaya', 'Guvenkaya'], ['fuzzland', 'Fuzzland'],
];

function detectFirm(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [token, name] of FIRM_TOKENS) if (lower.includes(token)) return name;
  return null;
}

function extractDate(filename: string): string | null {
  const m = filename.match(/(20\d{2})[-_.](0?[1-9]|1[0-2])[-_.](0?[1-9]|[12]\d|3[01])/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const ym = filename.match(/(20\d{2})[-_.](0?[1-9]|1[0-2])(?![\d])/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2,'0')}-01`;
  const y = filename.match(/\b(20\d{2})\b/);
  if (y) return `${y[1]}-01-01`;
  return null;
}

function extractDomain(s: string): string {
  return s.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
}

function isAuditFile(pathInRepo: string, filename: string, firm: string | null): boolean {
  const lp = pathInRepo.toLowerCase();
  const lf = filename.toLowerCase();
  // Reject obvious junk
  if (/template|example|sample|readme|license|index|changelog|contributing|deployed-addresses|deployment|abi[s]?\.|interface/i.test(lf)) return false;
  // PDFs in any path = highly likely an audit (unless rejected above)
  if (/\.pdf$/i.test(lf)) return true;
  // Markdown: must be in an audit-related folder OR mention firm OR mention 'audit'
  if (firm) return true;
  if (/\b(audit|security|review|pentest|report)\b/i.test(lp)) return true;
  if (/\b(audit|security|review|pentest|report)\b/i.test(lf)) return true;
  return false;
}

type RepoCandidate = { owner: string; repo: string; pushed_at?: string };

async function listOrgRepos(org: string, ghToken: string): Promise<{ name: string; pushed_at: string }[]> {
  for (const endpoint of [`users/${org}/repos`, `orgs/${org}/repos`]) {
    try {
      const r = await fetch(`https://api.github.com/${endpoint}?per_page=100&sort=pushed`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `token ${ghToken}`, 'User-Agent': 'AuditScope/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr)) return arr.map((x: any) => ({ name: x.name, pushed_at: x.pushed_at }));
      }
    } catch {}
  }
  return [];
}

async function listFiles(owner: string, repo: string, path: string, ghToken: string, depth = 0): Promise<{ name: string; download_url: string; html_url: string }[]> {
  if (depth > 3) return [];
  const out: { name: string; download_url: string; html_url: string }[] = [];
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?per_page=200`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `token ${ghToken}`, 'User-Agent': 'AuditScope/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return [];
    const items = await r.json();
    if (!Array.isArray(items)) return [];
    for (const f of items as any[]) {
      if (f.type === 'file' && /\.(pdf|md)$/i.test(f.name)) {
        out.push({ name: f.path, download_url: f.download_url || f.html_url, html_url: f.html_url });
      } else if (f.type === 'dir' && /audit|security|review|pentest|report/i.test(f.name)) {
        out.push(...await listFiles(owner, repo, f.path, ghToken, depth + 1));
      }
    }
  } catch {}
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ghToken = Deno.env.get('GITHUB_TOKEN') || '';
  if (!ghToken) return json(500, { error: 'GITHUB_TOKEN missing' });
  const cronKey = req.headers.get('x-cron-key') || '';
  if (cronKey !== CRON_KEY) return json(401, { error: 'Unauthorized' });
  const admin = createClient(supabaseUrl, serviceKey);

  const body = (await req.json().catch(() => ({}))) as { limit?: number; slug?: string };
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);

  let q = admin.from('companies').select('slug,name,github,last_audit_date').not('github', 'is', null);
  if (body.slug) q = q.eq('slug', body.slug);
  q = q.limit(limit);
  const { data: companies, error: qerr } = await q;
  if (qerr) return json(500, { error: qerr.message });
  if (!companies || companies.length === 0) return json(200, { ok: true, scanned: 0 });

  let scanned = 0, reposChecked = 0, pdfsFound = 0, inserted = 0, dupes = 0, errors = 0;
  const samples: any[] = [];

  for (const c of companies as any[]) {
    scanned++;
    if (!Array.isArray(c.github) || c.github.length === 0) continue;
    const candidates: RepoCandidate[] = [];
    for (const token of c.github as string[]) {
      const stripped = extractDomain(String(token));
      const parts = stripped.split('/').filter(Boolean);
      if (parts.length >= 2) candidates.push({ owner: parts[0], repo: parts[1] });
      if (parts.length >= 1 && parts[0]) {
        const repos = await listOrgRepos(parts[0], ghToken);
        for (const r of repos) {
          if (/audit|security|review|pentest/i.test(r.name)) candidates.push({ owner: parts[0], repo: r.name, pushed_at: r.pushed_at });
        }
      }
    }

    const seen = new Set<string>();
    for (const cand of candidates) {
      const key = `${cand.owner}/${cand.repo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reposChecked++;
      let pdfsInRepo = 0;
      for (const path of ['', 'audits', 'audit']) {
        const files = await listFiles(cand.owner, cand.repo, path, ghToken);
        if (files.length === 0) continue;
        for (const f of files) {
          const firm = detectFirm(f.name);
          if (!isAuditFile(f.name, f.name.split('/').pop() || '', firm)) continue;
          pdfsInRepo++;
          pdfsFound++;
          const date = extractDate(f.name);
          const { data: existing } = await admin.from('audit_history').select('id').eq('report_url', f.download_url).maybeSingle();
          if (existing) { dupes++; continue; }
          const { error: ie } = await admin.from('audit_history').insert({
            company_slug: c.slug,
            protocol_name: c.name,
            audit_firm: firm || 'Self-reported',
            audit_date: date,
            report_url: f.download_url,
            data_source: `company_repo:${cand.owner}/${cand.repo}`,
          });
          if (!ie) { inserted++; if (samples.length < 8) samples.push({ slug: c.slug, repo: key, file: f.name, firm: firm || 'self' }); }
          else if ((ie as any).code === '23505') dupes++;
          else errors++;
        }
        if (pdfsInRepo > 0) break;
      }
    }
  }

  return json(200, { ok: true, scanned, repos_checked: reposChecked, pdfs_found: pdfsFound, inserted, dupes, errors, samples });
});
