import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type ProtectedRouteProps = {
  children: ReactNode
  allowApplication?: boolean
  allowPaymentSetup?: boolean
  requiredPermission?: string
}

export default function ProtectedRoute({ children, allowApplication = false, requiredPermission }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [applicationRequired, setApplicationRequired] = useState(false)
  const [membershipDenied, setMembershipDenied] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let active = true

    async function loadAccess() {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      setSession(data.session)
      setApplicationRequired(false)
      setMembershipDenied(false)
      setPermissionDenied(false)

      if (data.session) {
        const { data: membership } = await supabase
          .from('restaurant_members')
          .select('restaurant_id,status,restaurants(status)')
          .eq('user_id', data.session.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (!active) return
        if (!membership || membership.status !== 'active') {
          setMembershipDenied(true)
          setLoading(false)
          return
        }

        const relation = membership.restaurants
        const restaurant = (Array.isArray(relation) ? relation[0] : relation) as { status?: string } | null
        setApplicationRequired(!restaurant || !['approved', 'active'].includes(restaurant.status ?? ''))

        if (requiredPermission) {
          const { data: allowed, error } = await supabase.rpc('restaurant_member_has_permission', { p_permission: requiredPermission })
          if (!active) return
          setPermissionDenied(Boolean(error) || allowed !== true)
        }
      }
      setLoading(false)
    }

    void loadAccess()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setApplicationRequired(false)
        setMembershipDenied(false)
        setPermissionDenied(false)
        setLoading(false)
      } else void loadAccess()
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [requiredPermission])

  if (loading) return <div className="screen-message">Loading your restaurant portal…</div>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (membershipDenied) return <div className="screen-message">Your restaurant access is suspended or no longer active. Contact the restaurant owner if you need access restored.</div>
  if (permissionDenied) return <Navigate to="/dashboard" replace />
  if (applicationRequired && !allowApplication) return <Navigate to="/onboarding" replace />
  return children
}
