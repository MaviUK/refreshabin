import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerNotifications.css'

type NotificationRow = {
  id: string
  notification_type: string
  title: string
  body: string
  action_url: string | null
  metadata: Record<string, unknown>
  read_at: string | null
  created_at: string
}

type NotificationResponse = {
  unread_count: number
  notifications: NotificationRow[]
}

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function iconFor(type: string) {
  if (type.includes('completed')) return '🎉'
  if (type.includes('expiring')) return '⏰'
  if (type.includes('reward')) return '🎁'
  return '⭐'
}

function safeActionUrl(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account/notifications'
  return value
}

export default function CustomerNotifications() {
  const navigate = useNavigate()
  const [data, setData] = useState<NotificationResponse>({ unread_count: 0, notifications: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [markingAll, setMarkingAll] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    const { data: session } = await supabase.auth.getSession()
    if (!session.session?.user) {
      navigate('/account/login?returnTo=%2Faccount%2Fnotifications', { replace: true })
      return
    }
    const { data: result, error: rpcError } = await supabase.rpc('get_customer_notifications', { p_limit: 100 })
    if (rpcError) setError(rpcError.message)
    else setData((result as NotificationResponse) || { unread_count: 0, notifications: [] })
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => filter === 'unread' ? data.notifications.filter((item) => !item.read_at) : data.notifications, [data, filter])

  async function openNotification(item: NotificationRow) {
    setError('')
    if (!item.read_at) {
      const { error: readError } = await supabase.rpc('mark_customer_notification_read', { p_notification_id: item.id })
      if (readError) {
        setError(readError.message)
        return
      }
      setData((current) => ({
        unread_count: Math.max(0, current.unread_count - 1),
        notifications: current.notifications.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row),
      }))
    }
    navigate(safeActionUrl(item.action_url))
  }

  async function markAllRead() {
    if (!data.unread_count || markingAll) return
    setMarkingAll(true)
    setError('')
    const { error: markError } = await supabase.rpc('mark_all_customer_notifications_read')
    if (markError) setError(markError.message)
    else {
      const now = new Date().toISOString()
      setData((current) => ({ unread_count: 0, notifications: current.notifications.map((item) => item.read_at ? item : { ...item, read_at: now }) }))
    }
    setMarkingAll(false)
  }

  if (loading) return <main className="customer-notifications-state">Loading notifications…</main>

  return <main className="customer-notifications-page">
    <header className="customer-notifications-header">
      <div><Link to="/account">← Account</Link><span>Loyalty updates</span><h1>Notifications</h1><p>Rewards, stamp-card progress and reminders from restaurants you order from.</p></div>
      <button type="button" onClick={() => void markAllRead()} disabled={!data.unread_count || markingAll}>{markingAll ? 'Marking read…' : 'Mark all read'}</button>
    </header>

    {error && <div className="customer-notifications-error" role="alert">{error}</div>}

    <nav className="customer-notifications-tabs" aria-label="Notification filters">
      <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
      <button type="button" className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Unread {data.unread_count > 0 && <strong>{data.unread_count}</strong>}</button>
    </nav>

    <section className="customer-notifications-list">
      {rows.length ? rows.map((item) => <button type="button" key={item.id} className={item.read_at ? 'read' : 'unread'} onClick={() => void openNotification(item)}>
        <span className="customer-notifications-icon" aria-hidden="true">{iconFor(item.notification_type)}</span>
        <span className="customer-notifications-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{dateTime.format(new Date(item.created_at))}</small></span>
        {!item.read_at && <i aria-label="Unread" />}
        <span className="customer-notifications-arrow">›</span>
      </button>) : <div className="customer-notifications-empty"><strong>{filter === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</strong><p>Your loyalty and reward updates will appear here.</p><Link to="/restaurants">Find food</Link></div>}
    </section>
  </main>
}
