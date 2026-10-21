// The API returns at most 1,000 rows per request (measured 2026-10-21: a
// request for 5,000 returned 1,000), so `.limit(5000)` or an unbounded select
// silently truncates. Anything shown as a total must page through every row.
//
// Usage: fetchAll((from, to) => supabase.from("t").select("a,b").eq(...).order("id").range(from, to))
// The query needs a stable order so pages don't overlap or skip rows.
export const PAGE_SIZE = 1000;

export async function fetchAll<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}
