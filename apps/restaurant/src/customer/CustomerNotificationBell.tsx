import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerNotificationBell.css'

type NotificationSummary = { unread_count?: number }

export default function CustomerNotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let active = true

    async function refresh() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) {
        if (active) setUnreadCount(0)
        return
      }

      const { data, error } = await supabase.rpc('get_customer_notifications', { p_limit: 1 })
      if (!error && active) setUnreadCount(Number((data as NotificationSummary | null)?.unread_count || 0))
    }

    void refresh()
    const handleVisibility = () => { if (document.visibilityState === 'visible') void refresh() }
    const handleFocus = () => void refresh()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const badge = unreadCount > 99 ? '99+' : String(unreadCount)

  return <Link className="customer-notification-bell" to="/account/notifications" aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}>
    <span aria-hidden="true">♢</span>
    {unreadCount > 0 && <strong>{badge}</strong>}
  </Link>
}
