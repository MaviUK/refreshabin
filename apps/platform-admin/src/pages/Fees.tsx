import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney, hasAdminPermission } from '../types'

type FeeSnapshot = {
  global: { commission_basis_points: number; commission_vat_basis_points: number; service_fee_pence: number; service_fee_enabled: boolean; updated_at: string }
  restaurants: Array<{ id: string; name: string; slug: string }>
  overrides: Array<{ id: string; restaurant_id: string; restaurant_name: string; commission_basis_points: number | null; service_fee_pence: number | null; effective_from: string; effective_until: string | null; reason: string }>
  history: Array<{ id: number; commission_basis_points: number; commission_vat_basis_points: number; service_fee_pence: number; service_fee_enabled: boolean; reason: string; created_at: string }>
}

const percentage = (basisPoints: number | null) => basisPoints == null ? 'Platform default' : `${(basisPoints / 100).toFixed(2)}%`
const poundsToPence = (value: string) => Math.round(Number(value || 0) * 100)

export default function Fees() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'finance:manage')
  const [snapshot, setSnapshot] = useState<FeeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [globalForm, setGlobalForm] = useState({ commission: '', vat: '', serviceFee: '', enabled: false, reason: '' })
  const [overrideForm, setOverrideForm] = useState({ restaurantId: '', commission: '', serviceFee: '', reason: '' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_fee_settings')
    if (loadError) setError(loadError.message)
    else {
      const next = data as FeeSnapshot
      setSnapshot(next)
      setGlobalForm({ commission: (next.global.commission_basis_points / 100).toString(), vat: (next.global.commission_vat_basis_points / 100).toString(), serviceFee: (next.global.service_fee_pence / 100).toFixed(2), enabled: next.global.service_fee_enabled, reason: '' })
      setOverrideForm((current) => ({ ...current, restaurantId: current.restaurantId || next.restaurants[0]?.id || '' }))
    }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  async function saveGlobal(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    if (!globalForm.reason.trim()) return setError('Enter a reason for this financial change.')
    setSaving(true)
    const { error: saveError } = await supabase.rpc('update_platform_fee_settings', { p_commission_basis_points: Math.round(Number(globalForm.commission) * 100), p_commission_vat_basis_points: Math.round(Number(globalForm.vat) * 100), p_service_fee_pence: poundsToPence(globalForm.serviceFee), p_service_fee_enabled: globalForm.enabled, p_reason: globalForm.reason })
    setSaving(false)
    if (saveError) return setError(saveError.message)
    setSuccess('Platform fee settings updated. New orders will use these values.'); await load()
  }

  async function saveOverride(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    if (!overrideForm.restaurantId || !overrideForm.reason.trim()) return setError('Choose a restaurant and enter a reason.')
    if (!overrideForm.commission.trim() && !overrideForm.serviceFee.trim()) return setError('Enter a commission or service-fee override.')
    setSaving(true)
    const restaurant = snapshot?.restaurants.find((item) => item.id === overrideForm.restaurantId)
    const { error: saveError } = await supabase.rpc('set_restaurant_fee_override', { p_restaurant_id: overrideForm.restaurantId, p_commission_basis_points: overrideForm.commission.trim() ? Math.round(Number(overrideForm.commission) * 100) : null, p_service_fee_pence: overrideForm.serviceFee.trim() ? poundsToPence(overrideForm.serviceFee) : null, p_reason: overrideForm.reason })
    setSaving(false)
    if (saveError) return setError(saveError.message)
    setSuccess(`${restaurant?.name || 'Restaurant'} override saved.`); setOverrideForm((current) => ({ ...current, commission: '', serviceFee: '', reason: '' })); await load()
  }

  return <div className="admin-page">
    <header className="page-heading"><div><span className="admin-kicker">Finance controls</span><h1>Fees & commission</h1><p>Control customer service fees and restaurant commission with immutable order snapshots.</p></div><button className="secondary-button" onClick={() => void load()} disabled={loading}>↻ Refresh</button></header>
    {error && <div className="admin-alert error" role="alert">{error}</div>}{success && <div className="admin-alert success" role="status">{success}</div>}
    {loading && <section className="admin-panel"><div className="panel-empty">Loading fee settings…</div></section>}
    {!loading && snapshot && <>
      <section className="fee-metrics"><article><small>Default commission</small><strong>{percentage(snapshot.global.commission_basis_points)}</strong><span>Applied to restaurant order value</span></article><article><small>VAT on commission</small><strong>{percentage(snapshot.global.commission_vat_basis_points)}</strong><span>Recorded separately per order</span></article><article><small>Customer service fee</small><strong>{snapshot.global.service_fee_enabled ? formatMoney(snapshot.global.service_fee_pence) : 'Off'}</strong><span>{snapshot.global.service_fee_enabled ? 'Added transparently at checkout' : 'Not charged to customers'}</span></article></section>
      <div className="fee-workspace">
        <form className="admin-panel fee-form" onSubmit={saveGlobal}><div className="panel-heading"><div><h2>Platform defaults</h2><p>Changes apply only to orders created afterwards.</p></div></div><div className="fee-form-body"><div className="fee-field-grid"><label>Commission (%)<input type="number" min="0" max="50" step="0.01" required value={globalForm.commission} onChange={(e) => setGlobalForm({ ...globalForm, commission: e.target.value })} disabled={!canManage || saving} /></label><label>VAT on commission (%)<input type="number" min="0" max="30" step="0.01" required value={globalForm.vat} onChange={(e) => setGlobalForm({ ...globalForm, vat: e.target.value })} disabled={!canManage || saving} /></label><label>Service fee (£)<input type="number" min="0" max="50" step="0.01" required value={globalForm.serviceFee} onChange={(e) => setGlobalForm({ ...globalForm, serviceFee: e.target.value })} disabled={!canManage || saving} /></label></div><label className="fee-toggle"><input type="checkbox" checked={globalForm.enabled} onChange={(e) => setGlobalForm({ ...globalForm, enabled: e.target.checked })} disabled={!canManage || saving} /><span><strong>Charge the service fee</strong><small>Shown separately before the customer pays.</small></span></label><label>Reason for change<textarea rows={3} required value={globalForm.reason} onChange={(e) => setGlobalForm({ ...globalForm, reason: e.target.value })} placeholder="Required for the audit log…" disabled={!canManage || saving} /></label>{canManage ? <button className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save platform defaults'}</button> : <div className="read-only-notice"><strong>Read-only access</strong><span>Finance management permission is required to change fees.</span></div>}</div></form>
        <form className="admin-panel fee-form" onSubmit={saveOverride}><div className="panel-heading"><div><h2>Restaurant override</h2><p>Blank fields continue using the platform default.</p></div></div><div className="fee-form-body"><label>Restaurant<select value={overrideForm.restaurantId} onChange={(e) => setOverrideForm({ ...overrideForm, restaurantId: e.target.value })} disabled={!canManage || saving}>{snapshot.restaurants.map((restaurant) => <option value={restaurant.id} key={restaurant.id}>{restaurant.name}</option>)}</select></label><div className="fee-field-grid two"><label>Commission (%)<input type="number" min="0" max="50" step="0.01" value={overrideForm.commission} onChange={(e) => setOverrideForm({ ...overrideForm, commission: e.target.value })} placeholder="Use default" disabled={!canManage || saving} /></label><label>Service fee (£)<input type="number" min="0" max="50" step="0.01" value={overrideForm.serviceFee} onChange={(e) => setOverrideForm({ ...overrideForm, serviceFee: e.target.value })} placeholder="Use default" disabled={!canManage || saving} /></label></div><label>Reason<textarea rows={3} required value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} placeholder="Commercial agreement or authorised reason…" disabled={!canManage || saving} /></label>{canManage && <button className="admin-primary-button" disabled={saving || !snapshot.restaurants.length}>Save restaurant override</button>}</div></form>
      </div>
      <section className="admin-panel fee-list"><div className="panel-heading"><div><h2>Active restaurant overrides</h2><p>The newest effective agreement is used at order creation.</p></div></div>{!snapshot.overrides.length && <div className="panel-empty"><strong>No overrides</strong><span>Every restaurant is using the platform defaults.</span></div>}{snapshot.overrides.map((override) => <article key={override.id}><div><strong>{override.restaurant_name}</strong><small>{override.reason}</small></div><span><small>Commission</small><strong>{percentage(override.commission_basis_points)}</strong></span><span><small>Service fee</small><strong>{override.service_fee_pence == null ? 'Platform default' : formatMoney(override.service_fee_pence)}</strong></span><time>{formatDate(override.effective_from, false)}</time></article>)}</section>
      <section className="admin-panel fee-history"><div className="panel-heading"><div><h2>Default change history</h2><p>Permanent financial configuration record.</p></div></div>{!snapshot.history.length && <div className="panel-empty">No default changes recorded yet.</div>}{snapshot.history.map((entry) => <article key={entry.id}><span><strong>{percentage(entry.commission_basis_points)} commission</strong><small>{entry.service_fee_enabled ? `${formatMoney(entry.service_fee_pence)} service fee` : 'Service fee off'} · VAT {percentage(entry.commission_vat_basis_points)}</small></span><p>{entry.reason}</p><time>{formatDate(entry.created_at)}</time></article>)}</section>
    </>}
  </div>
}
