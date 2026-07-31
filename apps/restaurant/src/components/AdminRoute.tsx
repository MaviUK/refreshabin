import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AdminRoute({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'signed-out' | 'forbidden' | 'allowed'>('loading')
  const location = useLocation()

  useEffect(() => {
    let active = true

    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!active) return
      if (!sessionData.session) {
        setState('signed-out')
        return
      }

      const { data, error } = await supabase.rpc('is_platform_admin')
      if (!active) return
      setState(!error && data === true ? 'allowed' : 'forbidden')
    })()

    return () => { active = false }
  }, [])

  if (state === 'loading') return <div className="screen-message">Checking administrator access…</div>
  if (state === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (state === 'forbidden') return <Navigate to="/dashboard" replace />
  return children
}
