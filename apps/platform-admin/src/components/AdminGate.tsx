import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AdminIdentity } from '../types'

export type AdminOutletContext = { admin: AdminIdentity }

export default function AdminGate() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'forbidden' | 'allowed'>('loading')
  const [admin, setAdmin] = useState<AdminIdentity | null>(null)
  const location = useLocation()

  useEffect(() => {
    let active = true

    async function checkAccess() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!active) return
      if (!sessionData.session) {
        setState('signed-out')
        return
      }

      const { data, error } = await supabase.rpc('claim_platform_admin_access')
      if (!active) return
      if (error || !data) {
        setState('forbidden')
        return
      }

      setAdmin(data as AdminIdentity)
      setState('allowed')
    }

    void checkAccess()
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && active) setState('signed-out')
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  if (state === 'loading') {
    return <main className="gate-screen"><div className="gate-spinner" /><strong>Checking platform access…</strong></main>
  }

  if (state === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (state === 'forbidden') {
    return <Navigate to="/login" replace state={{ accessDenied: true }} />
  }

  return admin ? <Outlet context={{ admin } satisfies AdminOutletContext} /> : null
}
