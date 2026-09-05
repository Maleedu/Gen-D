import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persisted in localStorage (the default) so a refresh doesn't kick the
    // admin back to the login screen — this is a desktop browser tool, not
    // the mobile app's React Native storage situation.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
