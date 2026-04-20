/**
 * Supabase client — shared singleton.
 *
 * The publishable key is deliberately public: security is enforced by
 * Row Level Security policies in the database. See
 * supabase/01_policies.sql.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://iqwfwdfcediizoapcmat.supabase.co';
export const SUPABASE_ANON_KEY =
  'sb_publishable_uuZn2VzDNoViiKOcqJfdFA_9YeqRAN6';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'runlink-session',
  },
});
