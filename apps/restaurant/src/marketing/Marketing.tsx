import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Marketing.css'

type Promotion = {
  id: string
  name: string
  code: string
  promotion_type: 'percentage' | 'fixed' | 'free_delivery' | 'birthday' | 'referral'
  percentage_basis_points: number | null
  fixed_discount_pence: number | null
  minimum_order_pence: number
  maximum_discount_pence: number | null
  starts_at: string
  ends_at: string | null
  total_redemption_limit: number | null
  per_customer_limit: number | null
  redemption_count: number
  first_order_only: boolean
  fulfilment_methods: string[]
  is_active: boolean
}

type DashboardData = {
  summary: {
    active_promotions: number
    total_promotions: number
    total_redemptions: number
    discount_given_pence: number
  }
  promotions: Promotion[]
}

type FormState = {
  name: string
  code: string
  promotionType: Promotion['promotion_type']
  value: string
  minimumOrder: string
  maximumDiscount: string
  startsAt: string
  endsAt: string
  totalLimit: string
  perCustomerLimit: string
  firstOrderOnly: boolean
  delivery: boolean
  collection: boolean
}

const initialForm: FormState = {
  name: '', code: '', promotionType: 'percentage', value: '10', minimumOrder: '0',
  maximumDiscount: '', startsAt: '', endsAt: '', totalLimit: '', perCustomerLimit: '1',
  firstOrderOnly: false, delivery: true, collection: true,
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const toPence = (value: string) => Math.round((Number(value || 0) + Number.EPSILON) * 100)
const toIsoOrNull = (value: string) => value ? new Date(value).toISOString() : null

function promotionValue(promotion: Promotion) {
  if (promotion.promotion_type === 'percentage') return `${(Number(promotion.percentage_basis_points || 0) / 100).toFixed(2).replace(/\.00$/, '')}% off`
  if (promotion.promotion_type === 'fixed') return `${money.format(Number(promotion.fixed_discount_pence || 0) / 100)} off`
  if (promotion.promotion_type === 'free_delivery') return 'Free delivery'
  if (promotion.promotion_type === 'birthday') return 'Birthday reward'
  return 'Referral reward'
}

export default function Marketing() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [form, setForm] = useState<FormState>(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'expired'>('all')

  const load = useCallback(async () => {
    setError('')
    const { data: result, error: rpcError } = await supabase.rpc('get_restaurant_marketing_dashboard')
    if (rpcError) setError(rpcError.message)
    else setData(result as DashboardData)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const visiblePromotions = useMemo(() => {
    const now = Date.now()
    return (data?.promotions ?? []).filter((promotion) => {
      const expired = Boolean(promotion.ends_at && new Date(promotion.ends_at).getTime() <= now)
      if (filter === 'active') return promotion.is_active && !expired
      if (filter === 'paused') return !promotion.is_active && !expired
      if (filter === 'expired') return expired
      return true
    })
  }, [data, filter])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function createPromotion(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!form.delivery && !form.collection) {
      setError('Choose delivery, collection, or both.')
      return
    }
    setSaving(true)
    const percentageBasisPoints = form.promotionType === 'percentage' ? Math.round(Number(form.value) * 100) : null
    const fixedDiscountPence = form.promotionType === 'fixed' ? toPence(form.value) : null
    const { error: createError } = await supabase.rpc('create_restaurant_promotion', {
      p_name: form.name.trim(),
      p_code: form.code.trim().toUpperCase(),
      p_promotion_type: form.promotionType,
      p_percentage_basis_points: percentageBasisPoints,
      p_fixed_discount_pence: fixedDiscountPence,
      p_minimum_order_pence: toPence(form.minimumOrder),
      p_maximum_discount_pence: form.maximumDiscount ? toPence(form.maximumDiscount) : null,
      p_starts_at: toIsoOrNull(form.startsAt) ?? new Date().toISOString(),
      p_ends_at: toIsoOrNull(form.endsAt),
      p_total_redemption_limit: form.totalLimit ? Number(form.totalLimit) : null,
      p_per_customer_limit: form.perCustomerLimit ? Number(form.perCustomerLimit) : null,
      p_first_order_only: form.firstOrderOnly,
      p_fulfilment_methods: [form.delivery && 'delivery', form.collection && 'collection'].filter(Boolean),
    })
    if (createError) setError(createError.message)
    else {
      setNotice('Promotion created successfully.')
      setForm(initialForm)
      setShowForm(false)
      await load()
    }
    setSaving(false)
  }

  async function togglePromotion(promotion: Promotion) {
    setBusyId(promotion.id)
    setError('')
    const { error: toggleError } = await supabase.rpc('set_restaurant_promotion_active', {
      p_promotion_id: promotion.id,
      p_is_active: !promotion.is_active,
    })
    if (toggleError) setError(toggleError.message)
    else await load()
    setBusyId('')
  }

  if (loading) return <main className="marketing-shell"><p>Loading marketing tools…</p></main>

  return (
    <main className="marketing-shell">
      <header className="marketing-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p>Restaurant marketing</p></div>
        <div className="marketing-header-actions"><Link className="secondary-button button-link" to="/marketing/milestones">Birthdays & milestones</Link><Link className="secondary-button button-link" to="/dashboard">Dashboard</Link><button className="primary-button" type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close builder' : 'New promotion'}</button></div>
      </header>

      <section className="marketing-hero">
        <div><span className="eyebrow">Growth tools</span><h1>Marketing</h1><p>Create offers that bring customers back and track how much value each promotion generates.</p></div>
      </section>

      {error && <p className="marketing-alert marketing-alert--error" role="alert">{error}</p>}
      {notice && <p className="marketing-alert marketing-alert--success">{notice}</p>}

      <section className="marketing-metrics">
        <article><span>Active promotions</span><strong>{data?.summary.active_promotions ?? 0}</strong></article>
        <article><span>Total promotions</span><strong>{data?.summary.total_promotions ?? 0}</strong></article>
        <article><span>Redemptions</span><strong>{data?.summary.total_redemptions ?? 0}</strong></article>
        <article><span>Discount value</span><strong>{money.format((data?.summary.discount_given_pence ?? 0) / 100)}</strong></article>
      </section>

      <section className="marketing-tools-grid">
        <article className="marketing-tool-card marketing-tool-card--active"><span>Promotions</span><strong>Create voucher campaigns</strong><small>Live now</small></article>
        <Link className="marketing-tool-card marketing-tool-card--active" to="/marketing/milestones"><span>Milestones</span><strong>Birthdays & customer milestones</strong><small>Live now</small></Link>
        <Link className="marketing-tool-card marketing-tool-card--active" to="/loyalty"><span>Loyalty</span><strong>Points and rewards</strong><small>Live now</small></Link>
        <Link className="marketing-tool-card marketing-tool-card--active" to="/gift-cards"><span>Gift cards</span><strong>Sell digital credit</strong><small>Live now</small></Link>
        <Link className="marketing-tool-card marketing-tool-card--active" to="/loyalty/referrals"><span>Referrals</span><strong>Reward recommendations</strong><small>Live now</small></Link>
      </section>

      {showForm && (
        <section className="marketing-panel">
          <div className="marketing-panel-heading"><div><span className="eyebrow">Promotion builder</span><h2>Create a promotion</h2></div></div>
          <form className="promotion-form" onSubmit={createPromotion}>
            <label><span>Promotion name</span><input required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Weekend saver" /></label>
            <label><span>Voucher code</span><input required value={form.code} onChange={(e) => update('code', e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="WEEKEND10" /></label>
            <label><span>Offer type</span><select value={form.promotionType} onChange={(e) => update('promotionType', e.target.value as Promotion['promotion_type'])}><option value="percentage">Percentage off</option><option value="fixed">Fixed amount off</option><option value="free_delivery">Free delivery</option><option value="birthday">Birthday reward</option><option value="referral">Referral reward</option></select></label>
            {(form.promotionType === 'percentage' || form.promotionType === 'fixed') && <label><span>{form.promotionType === 'percentage' ? 'Discount percentage' : 'Discount amount (£)'}</span><input required type="number" min="0.01" step="0.01" value={form.value} onChange={(e) => update('value', e.target.value)} /></label>}
            <label><span>Minimum order (£)</span><input type="number" min="0" step="0.01" value={form.minimumOrder} onChange={(e) => update('minimumOrder', e.target.value)} /></label>
            <label><span>Maximum discount (£)</span><input type="number" min="0" step="0.01" value={form.maximumDiscount} onChange={(e) => update('maximumDiscount', e.target.value)} placeholder="Optional" /></label>
            <label><span>Starts</span><input type="datetime-local" value={form.startsAt} onChange={(e) => update('startsAt', e.target.value)} /></label>
            <label><span>Ends</span><input type="datetime-local" value={form.endsAt} onChange={(e) => update('endsAt', e.target.value)} /></label>
            <label><span>Total redemption limit</span><input type="number" min="1" value={form.totalLimit} onChange={(e) => update('totalLimit', e.target.value)} placeholder="Unlimited" /></label>
            <label><span>Uses per customer</span><input type="number" min="1" value={form.perCustomerLimit} onChange={(e) => update('perCustomerLimit', e.target.value)} /></label>
            <fieldset><legend>Valid for</legend><label className="check-row"><input type="checkbox" checked={form.delivery} onChange={(e) => update('delivery', e.target.checked)} /> Delivery</label><label className="check-row"><input type="checkbox" checked={form.collection} onChange={(e) => update('collection', e.target.checked)} /> Collection</label></fieldset>
            <label className="check-row promotion-wide"><input type="checkbox" checked={form.firstOrderOnly} onChange={(e) => update('firstOrderOnly', e.target.checked)} /> First order only</label>
            <div className="promotion-form-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Creating…' : 'Create promotion'}</button></div>
          </form>
        </section>
      )}

      <section className="marketing-panel">
        <div className="marketing-panel-heading"><div><span className="eyebrow">Promotions</span><h2>Your campaigns</h2></div><div className="promotion-filters">{(['all','active','paused','expired'] as const).map((item) => <button className={filter === item ? 'active' : ''} type="button" key={item} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
        {visiblePromotions.length === 0 ? <div className="marketing-empty"><h3>No promotions in this view</h3><p>Create your first offer or choose a different filter.</p></div> : <div className="promotion-list">{visiblePromotions.map((promotion) => {
          const expired = Boolean(promotion.ends_at && new Date(promotion.ends_at).getTime() <= Date.now())
          return <article className="promotion-card" key={promotion.id}><div><span className="promotion-code">{promotion.code}</span><h3>{promotion.name}</h3><p>{promotionValue(promotion)} · Minimum {money.format(promotion.minimum_order_pence / 100)}</p><small>{promotion.fulfilment_methods.join(' & ')}{promotion.first_order_only ? ' · First order only' : ''}</small></div><div className="promotion-card-stats"><span><strong>{promotion.redemption_count}</strong> uses</span><span>{promotion.total_redemption_limit ? `${promotion.total_redemption_limit} max` : 'Unlimited'}</span><span className={`promotion-status ${expired ? 'expired' : promotion.is_active ? 'live' : 'paused'}`}>{expired ? 'Expired' : promotion.is_active ? 'Live' : 'Paused'}</span></div><button className="secondary-button" type="button" disabled={expired || busyId === promotion.id} onClick={() => void togglePromotion(promotion)}>{busyId === promotion.id ? 'Saving…' : promotion.is_active ? 'Pause' : 'Activate'}</button></article>
        })}</div>}
      </section>
    </main>
  )
}
