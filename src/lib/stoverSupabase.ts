import { createClient } from "@supabase/supabase-js";

// Separate Supabase client for the STOVER / Otto pilot project.
// Read-only via RLS — anon key only. Temp page; will be removed.
const URL = import.meta.env.VITE_STOVER_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_STOVER_SUPABASE_ANON_KEY as string | undefined;

export const stoverSupabase = (URL && KEY)
  ? createClient(URL, KEY, { auth: { persistSession: false } })
  : null;

export const stoverConfigured = !!stoverSupabase;

// Read-only handle to the main AuditScope DB for Otto Cat 7 ("comparable
// transactions") signal: same-category recent funding rounds drawn from the
// 10K-company / 3.6K-round corpus. Anon-key only, read-only via RLS.
const MAIN_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const MAIN_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const auditscopeMainSupabase = (MAIN_URL && MAIN_KEY)
  ? createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } })
  : null;
