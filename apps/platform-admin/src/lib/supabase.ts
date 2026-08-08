import { createClient } from '@supabase/supabase-js'

export const hasPasswordRecoveryParams =
  window.location.hash.includes('type=recovery') ||
  new URLSearchParams(window.location.search).get('type') === 'recovery'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'ordered-food-platform-admin-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
