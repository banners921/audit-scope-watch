import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SNAPSHOT_GQL = 'https://hub.snapshot.org/graphql';

async function fetchProposals(spaceId: string, limit = 20) {
  const q = `query Props($space: String!, $first: Int!) {\n    proposals(\n      first: $first,\n      skip: 0,\n      where: { space: $space },\n      orderBy: \"created\",\n      orderDirection: desc\n    ) {\n      id title body state author start end created scores scores_total scores_state votes choices\n      space { id }\n    }\n  }`;
  const resp = await fetch(SNAPSHOT_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { space: spaceId, first: limit } }),
  });
  if (!resp.ok) throw new Error(`snapshot HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors).slice(0, 200));
  return data.data?.proposals ?? [];
}

// Auth: this endpoint runs service-role queries against the database, so it
// must never be anonymously callable.
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
function authorised(req: Request): boolean {
  // An unset secret must not authorise everyone ("" === "" would).
  return CRON_KEY !== "" && req.headers.get("x-cron-key") === CRON_KEY;
}
const UNAUTH = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (!authorised(req)) return UNAUTH();
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const limit = Number(body.limit || 12);
  const onlySpace = body.space as string | undefined;
  const onlySlug = body.company_slug as string | undefined;

  let q = sb.from('snapshot_spaces').select('company_slug,space_id');
  if (onlySpace) q = q.eq('space_id', onlySpace);
  if (onlySlug) q = q.eq('company_slug', onlySlug);
  const { data: spaces, error } = await q.limit(limit);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let totalIngested = 0;
  const errors: any[] = [];
  for (const sp of (spaces ?? [])) {
    try {
      const props = await fetchProposals(sp.space_id, 15);
      const rows = props.map((p: any) => ({
        id: p.id,
        company_slug: sp.company_slug,
        snapshot_space: sp.space_id,
        title: p.title,
        body: typeof p.body === 'string' ? p.body.slice(0, 4000) : null,
        state: p.state,
        scores_total: p.scores_total ?? null,
        votes_count: p.votes ?? null,
        choices: p.choices ?? null,
        scores: p.scores ?? null,
        author: p.author ?? null,
        start_ts: p.start ? new Date(p.start * 1000).toISOString() : null,
        end_ts: p.end ? new Date(p.end * 1000).toISOString() : null,
        source: 'snapshot',
        url: `https://snapshot.org/#/${sp.space_id}/proposal/${p.id}`,
      }));
      if (rows.length > 0) {
        const { error: upErr } = await sb.from('governance_proposals').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
        if (upErr) { errors.push({ slug: sp.company_slug, err: upErr.message }); continue; }
        totalIngested += rows.length;
        await sb.from('snapshot_spaces').update({ last_synced_at: new Date().toISOString() }).eq('company_slug', sp.company_slug);
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      errors.push({ slug: sp.company_slug, err: String(e).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ ok: true, ingested: totalIngested, spaces_processed: spaces?.length ?? 0, errors }), { headers: { 'Content-Type': 'application/json' } });
});
