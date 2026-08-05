import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export type SubscriptionFeature =
  | 'advanced_reporting'
  | 'marketing'
  | 'priority_support'
  | 'ai_menu_import'
  | 'multi_location'
  | 'api_access'

export type SubscriptionAccessSnapshot = {
  loading: boolean
  allowed: boolean
  reason: string | null
  status: string | null
  planCode: string | null
  planName: string | null
  trialEndsAt: string | null
  gracePeriodEndsAt: string | null
  features: Record<string, boolean | number | string>
  hasFeature: (feature: SubscriptionFeature) => boolean
  refresh: () => Promise<void>
}

const emptySnapshot: SubscriptionAccessSnapshot = {
  loading: true,
  allowed: false,
  reason: null,
  status: null,
  planCode: null,
  planName: null,
  trialEndsAt: null,
  gracePeriodEndsAt: null,
  features: {},
  hasFeature: () => false,
  refresh: async () => undefined,
}

const SubscriptionAccessContext = createContext<SubscriptionAccessSnapshot>(emptySnapshot)

export function SubscriptionAccessProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState<any>(null)

  const refresh = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      setPayload(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase.rpc('get_restaurant_subscription_status')
    setPayload(error ? null : data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refresh())
    return () => listener.subscription.unsubscribe()
  }, [refresh])

  const value = useMemo<SubscriptionAccessSnapshot>(() => {
    const subscription = payload?.subscription ?? null
    const features = subscription?.plan?.features ?? {}
    const allowed = Boolean(payload?.access?.allowed)
    return {
      loading,
      allowed,
      reason: payload?.access?.reason ?? null,
      status: subscription?.status ?? null,
      planCode: subscription?.plan?.code ?? null,
      planName: subscription?.plan?.name ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      gracePeriodEndsAt: subscription?.grace_period_ends_at ?? null,
      features,
      hasFeature: (feature) => allowed && features[feature] === true,
      refresh,
    }
  }, [loading, payload, refresh])

  return <SubscriptionAccessContext.Provider value={value}>{children}</SubscriptionAccessContext.Provider>
}

export function useSubscriptionAccess() {
  return useContext(SubscriptionAccessContext)
}
