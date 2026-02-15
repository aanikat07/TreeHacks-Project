import { createClient } from "@supabase/supabase-js";

export function canUseSupabaseAdmin() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin env vars are not configured.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
