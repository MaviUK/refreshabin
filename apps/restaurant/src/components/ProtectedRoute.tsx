import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type ProtectedRouteProps = {
  children: ReactNode
  allowApplication?: boolean
}

export default function ProtectedRoute({ children, allowApplication = false }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [applicationRequired, setApplicationRequired] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(async ({ data }) => {
      if (active) {
        setSession(data.session)
        if (data.session && !allowApplication) {
          const { data: membership } = await supabase
            .from('restaurant_members')
            .select('restaurant_id,restaurants(status)')
            .eq('user_id', data.session.user.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          const relation = membership?.restaurants
          const restaurant = Array.isArray(relation) ? relation[0] : relation
          const status = (restaurant as { status?: string } | null)?.status
          setApplicationRequired(!restaurant || !['approved', 'active'].includes(status ?? ''))
        }
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [allowApplication])

  if (loading) {
    return <div className="screen-message">Loading your restaurant portal…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (applicationRequired && !allowApplication) {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
