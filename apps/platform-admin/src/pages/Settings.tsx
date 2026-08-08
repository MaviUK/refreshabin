import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney, hasAdminPermission } from '../types'

type NotificationPreferences = {
  new_restaurant_applications: boolean
  failed_payments: boolean
  high_value_refunds: boolean
  restaurants_going_offline: boolean
  high_value_refund_threshold_pence: number
}

type FeatureFlags = {
  scheduled_orders: boolean
  customer_favourites: boolean
  restaurant_quick_availability: boolean
}

type Configuration = {
  maintenance_mode: boolean
  maintenance_title: string
  maintenance_message: string
  ordering_enabled: boolean
  ordering_pause_message: string
  notification_preferences: NotificationPreferences
  feature_flags: FeatureFlags
  updated_at: string
  updated_by_name: string
}

type HistoryEntry = {
  id: number
  reason: string
  previous_configuration: Partial<Configuration>
  next_configuration: Partial<Configuration>
  actor_name: string
  created_at: string
}

type ConfigurationSnapshot = { configuration: Configuration; history: HistoryEntry[] }

type FormState = {
  maintenanceMode: boolean
  maintenanceTitle: string
  maintenanceMessage: string
  orderingEnabled: boolean
  orderingPauseMessage: string
  notifications: NotificationPreferences
  flags: FeatureFlags
  reason: string
}

const notificationOptions: Array<{ key: Exclude<keyof NotificationPreferences, 'high_value_refund_threshold_pence'>; label: string; description: string }> = [
  { key: 'new_restaurant_applications', label: 'New restaurant applications', description: 'Alert administrators when an application enters the review queue.' },
  { key: 'failed_payments', label: 'Failed payments', description: 'Flag payment failures that may need customer support.' },
  { key: 'high_value_refunds', label: 'High-value refunds', description: 'Escalate successful refunds at or above the threshold below.' },
  { key: 'restaurants_going_offline', label: 'Restaurants going offline', description: 'Highlight active restaurants that stop accepting orders.' },
]

const featureOptions: Array<{ key: keyof FeatureFlags; label: string; description: string }> = [
  { key: 'scheduled_orders', label: 'Scheduled orders', description: 'Let customers choose a delivery or collection time up to seven days ahead.' },
  { key: 'customer_favourites', label: 'Customer favourites', description: 'Show saved restaurants and menu items across customer accounts and storefronts.' },
  { key: 'restaurant_quick_availability', label: 'Quick sold-out controls', description: 'Let restaurants pause and re-enable items directly from their live storefront.' },
]

function toForm(configuration: Configuration): FormState {
  return {
    maintenanceMode: configuration.maintenance_mode,
    maintenanceTitle: configuration.maintenance_title,
    maintenanceMessage: configuration.maintenance_message,
    orderingEnabled: configuration.ordering_enabled,
    orderingPauseMessage: configuration.ordering_pause_message,
    notifications: configuration.notification_preferences,
    flags: configuration.feature_flags,
    reason: '',
  }
}

export default function Settings() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'settings:manage')
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshot | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_configuration')
    if (loadError) setError(loadError.message)
    else {
      const next = data as ConfigurationSnapshot
      setSnapshot(next)
      setForm(toForm(next.configuration))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(() => {
    if (!snapshot || !form) return false
    const current = snapshot.configuration
    return form.maintenanceMode !== current.maintenance_mode
      || form.maintenanceTitle.trim() !== current.maintenance_title
      || form.maintenanceMessage.trim() !== current.maintenance_message
      || form.orderingEnabled !== current.ordering_enabled
      || form.orderingPauseMessage.trim() !== current.ordering_pause_message
      || JSON.stringify(form.notifications) !== JSON.stringify(current.notification_preferences)
      || JSON.stringify(form.flags) !== JSON.stringify(current.feature_flags)
  }, [form, snapshot])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form || !snapshot || saving) return
    setError('')
    setSuccess('')
    if (!changed) return setError('Make a configuration change before saving.')
    if (form.reason.trim().length < 5) return setError('Enter a clear reason for this configuration change.')

    setSaving(true)
    const { error: saveError } = await supabase.rpc('update_platform_configuration', {
      p_maintenance_mode: form.maintenanceMode,
      p_maintenance_title: form.maintenanceTitle,
      p_maintenance_message: form.maintenanceMessage,
      p_ordering_enabled: form.orderingEnabled,
      p_ordering_pause_message: form.orderingPauseMessage,
      p_notification_preferences: form.notifications,
      p_feature_flags: form.flags,
      p_reason: form.reason,
      p_expected_updated_at: snapshot.configuration.updated_at,
    })
    setSaving(false)
    if (saveError) return setError(saveError.message)
    setSuccess('Platform configuration updated. Customer-facing controls are live.')
    await load()
  }

  return <div className="admin-page">
    <header className="page-heading"><div><span className="admin-kicker">Platform controls</span><h1>Configuration</h1><p>Control customer ordering, maintenance messaging, notifications and staged feature releases.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || saving}>↻ Refresh</button></header>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {success && <div className="admin-alert success" role="status">{success}</div>}
    {loading && <section className="admin-panel"><div className="panel-empty">Loading platform configuration…</div></section>}

    {!loading && form && snapshot && <form className="configuration-workspace" onSubmit={save}>
      <section className="configuration-status-grid" aria-label="Current platform status">
        <StatusCard label="Customer platform" active={!form.maintenanceMode} activeText="Available" inactiveText="Maintenance" detail={form.maintenanceMode ? form.maintenanceTitle : 'Customer ordering surfaces are available.'} />
        <StatusCard label="New orders" active={form.orderingEnabled && !form.maintenanceMode} activeText="Enabled" inactiveText="Paused" detail={form.maintenanceMode ? 'Blocked by maintenance mode' : form.orderingEnabled ? 'Restaurants can receive new paid orders.' : 'Browsing and existing order tracking remain available.'} />
        <article className="configuration-status-card"><small>Last updated</small><strong>{formatDate(snapshot.configuration.updated_at)}</strong><span>By {snapshot.configuration.updated_by_name}</span></article>
      </section>

      <section className="admin-panel configuration-panel">
        <div className="panel-heading"><div><h2>Ordering & maintenance</h2><p>These switches are enforced in Postgres as well as the customer interface.</p></div></div>
        <div className="configuration-panel-body">
          <Toggle checked={form.maintenanceMode} onChange={(checked) => setForm({ ...form, maintenanceMode: checked })} disabled={!canManage || saving} label="Maintenance mode" description="Replace customer ordering pages with a status screen and block new orders and payment sessions." tone="danger" />
          <div className="configuration-message-grid">
            <label>Maintenance heading<input maxLength={120} minLength={3} required value={form.maintenanceTitle} onChange={(event) => setForm({ ...form, maintenanceTitle: event.target.value })} disabled={!canManage || saving} /></label>
            <label className="wide">Maintenance message<textarea maxLength={500} minLength={10} rows={3} required value={form.maintenanceMessage} onChange={(event) => setForm({ ...form, maintenanceMessage: event.target.value })} disabled={!canManage || saving} /></label>
          </div>
          <Toggle checked={form.orderingEnabled} onChange={(checked) => setForm({ ...form, orderingEnabled: checked })} disabled={!canManage || saving} label="Accept new orders platform-wide" description="When paused, customers can browse and track orders but cannot create a new order or payment session." />
          <div className="configuration-message-grid"><label className="wide">Ordering paused message<textarea maxLength={500} minLength={10} rows={3} required value={form.orderingPauseMessage} onChange={(event) => setForm({ ...form, orderingPauseMessage: event.target.value })} disabled={!canManage || saving} /></label></div>
          <div className="configuration-impact-note"><strong>In-flight payments</strong><span>Already-open Stripe Checkout sessions may still complete. These controls stop new orders and new payment sessions immediately.</span></div>
        </div>
      </section>

      <div className="configuration-two-column">
        <section className="admin-panel configuration-panel">
          <div className="panel-heading"><div><h2>Feature releases</h2><p>Pause selected customer or restaurant features without a redeploy.</p></div></div>
          <div className="configuration-toggle-list">{featureOptions.map((option) => <Toggle key={option.key} checked={form.flags[option.key]} onChange={(checked) => setForm({ ...form, flags: { ...form.flags, [option.key]: checked } })} disabled={!canManage || saving} label={option.label} description={option.description} />)}</div>
        </section>

        <section className="admin-panel configuration-panel">
          <div className="panel-heading"><div><h2>Administrator notifications</h2><p>Choose which operational events should generate administrator alerts.</p></div></div>
          <div className="configuration-toggle-list">
            {notificationOptions.map((option) => <Toggle key={option.key} checked={form.notifications[option.key]} onChange={(checked) => setForm({ ...form, notifications: { ...form.notifications, [option.key]: checked } })} disabled={!canManage || saving} label={option.label} description={option.description} />)}
            <label className="configuration-threshold">High-value refund threshold (£)<input type="number" min="0" max="100000" step="0.01" value={(form.notifications.high_value_refund_threshold_pence / 100).toFixed(2)} onChange={(event) => setForm({ ...form, notifications: { ...form.notifications, high_value_refund_threshold_pence: Math.round(Number(event.target.value || 0) * 100) } })} disabled={!canManage || saving || !form.notifications.high_value_refunds} /><small>Current threshold: {formatMoney(form.notifications.high_value_refund_threshold_pence)}</small></label>
          </div>
        </section>
      </div>

      <section className="admin-panel configuration-save-panel">
        <div><span className="admin-kicker">Controlled change</span><h2>Review and save</h2><p>Every configuration change is permanently recorded with its before and after values.</p></div>
        {canManage ? <div className="configuration-save-controls"><label>Reason for change<textarea maxLength={500} minLength={5} rows={3} required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Required for the audit trail…" disabled={saving} /></label><div><button className="secondary-button" type="button" disabled={saving || !changed} onClick={() => setForm(toForm(snapshot.configuration))}>Discard changes</button><button className="admin-primary-button" type="submit" disabled={saving || !changed}>{saving ? 'Saving…' : 'Save configuration'}</button></div></div> : <div className="read-only-notice"><strong>Read-only access</strong><span>Only a super administrator can change platform configuration.</span></div>}
      </section>
    </form>}

    {!loading && snapshot && <section className="admin-panel configuration-history">
      <div className="panel-heading"><div><h2>Configuration history</h2><p>The latest 20 audited changes.</p></div></div>
      {!snapshot.history.length && <div className="panel-empty"><strong>No changes yet</strong><span>The platform is using its safe default configuration.</span></div>}
      {snapshot.history.map((entry) => <article key={entry.id}><span className="configuration-history-icon">↻</span><div><strong>{entry.reason}</strong><small>{summariseChange(entry)}</small></div><span><strong>{entry.actor_name}</strong><small>{formatDate(entry.created_at)}</small></span></article>)}
    </section>}
  </div>
}

function Toggle({ checked, onChange, disabled, label, description, tone }: { checked: boolean; onChange: (checked: boolean) => void; disabled: boolean; label: string; description: string; tone?: 'danger' }) {
  return <label className={`configuration-toggle${tone ? ` ${tone}` : ''}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /><span className="configuration-switch" aria-hidden="true"><i /></span><span><strong>{label}</strong><small>{description}</small></span></label>
}

function StatusCard({ label, active, activeText, inactiveText, detail }: { label: string; active: boolean; activeText: string; inactiveText: string; detail: string }) {
  return <article className={`configuration-status-card ${active ? 'active' : 'inactive'}`}><small>{label}</small><strong><i />{active ? activeText : inactiveText}</strong><span>{detail}</span></article>
}

function summariseChange(entry: HistoryEntry) {
  const changes: string[] = []
  if (entry.previous_configuration.maintenance_mode !== entry.next_configuration.maintenance_mode) changes.push(entry.next_configuration.maintenance_mode ? 'Maintenance enabled' : 'Maintenance disabled')
  if (entry.previous_configuration.ordering_enabled !== entry.next_configuration.ordering_enabled) changes.push(entry.next_configuration.ordering_enabled ? 'Ordering enabled' : 'Ordering paused')
  if (JSON.stringify(entry.previous_configuration.feature_flags) !== JSON.stringify(entry.next_configuration.feature_flags)) changes.push('Feature flags changed')
  if (JSON.stringify(entry.previous_configuration.notification_preferences) !== JSON.stringify(entry.next_configuration.notification_preferences)) changes.push('Notification rules changed')
  if (!changes.length) changes.push('Customer messaging changed')
  return changes.join(' · ')
}
