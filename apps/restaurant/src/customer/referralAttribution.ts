import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'ordered-food-referral-attribution'

type PendingReferral = { token: string; expiresAt?: string; restaurantSlug?: string }

export function saveReferralAttribution(value: PendingReferral) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function getReferralAttribution(): PendingReferral | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as PendingReferral
    if (!value?.token) return null
    if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return value
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function claimPendingReferralAttribution() {
  const pending = getReferralAttribution()
  if (!pending) return null
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) return null
  const { data, error } = await supabase.rpc('claim_referral_attribution', { p_token: pending.token })
  if (!error) window.localStorage.removeItem(STORAGE_KEY)
  return { data, error }
}
