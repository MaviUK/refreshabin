import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Subscription.css'

type Plan = {
  id: string
  code: string
  name: string
  description: string
  monthly_price_pence: number
  annual_price_pence: number | null
  trial_days: number
  features: Record<string, boolean | number | string>
}

type SubscriptionRecord = {
  id: string
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'unpaid'
  billing_interval: 'monthly' | 'annual'
  trial_ends_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  grace_period_ends_at: string | null
  last_payment_failed_at: string | null
  plan: Plan
}

type SubscriptionStatus = {
  restaurant_id: string
  subscription: SubscriptionRecord | null
  plans: Plan[]
  access: { allowed: boolean; reason: string }
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const formatMoney = (pence: number) => money.format((pence || 0) / 100)
const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not available'

function daysRemaining(value: string | null) {
  if (!value) return 0
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000))
}

function featureLabel(key: string, value: boolean | number | string) {
  const labels: Record<string, string> = {
    locations: 'locations',
    staff_users: 'staff users',
    advanced_reporting: 'Advanced reporting',
    marketing: 'Marketing tools',
    priority_support: 'Priority support',
  }
  if (typeof value === 'boolean') return value ? labels[key] || key.replaceAll('_', ' ') : ''
  return `${value} ${labels[key] || key.replaceAll('_', ' ')}`
}

export default function Subscription() {
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<SubscriptionStatus | null>(null)
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: result, error: invokeError } = await supabase.functions.invoke('restaurant-subscription-billing', { body: { action: 'status' } })
    if (invokeError) setError(invokeError.message)
    else {
      const status = result as SubscriptionStatus
      setData(status)
      if (status.subscription?.billing_interval) setInterval(status.subscription.billing_interval)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (searchParams.get('subscription') === 'success') {
      const timer = window.setTimeout(() => void load(), 1200)
      return () => window.clearTimeout(timer)
    }
  }, [load, searchParams])

  async function startCheckout(plan: Plan) {
    setBusy(plan.id)
    setError('')
    const { data: result, error: invokeError } = await supabase.functions.invoke('restaurant-subscription-billing', {
      body: { action: 'checkout', plan_id: plan.id, billing_interval: interval },
    })
    if (invokeError || !result?.url) {
      setError(invokeError?.message || result?.error || 'Unable to start subscription checkout.')
      setBusy('')
      return
    }
    window.location.assign(result.url)
  }

  async function openPortal() {
    setBusy('portal')
    setError('')
    const { data: result, error: invokeError } = await supabase.functions.invoke('restaurant-subscription-billing', { body: { action: 'portal' } })
    if (invokeError || !result?.url) {
      setError(invokeError?.message || result?.error || 'Unable to open billing management.')
      setBusy('')
      return
    }
    window.location.assign(result.url)
  }

  const current = data?.subscription
  const trialDays = useMemo(() => daysRemaining(current?.trial_ends_at ?? null), [current?.trial_ends_at])
  const graceDays = useMemo(() => daysRemaining(current?.grace_period_ends_at ?? null), [current?.grace_period_ends_at])

  if (loading && !data) return <main className="subscription-page"><section className="subscription-panel">Loading subscription…</section></main>

  return (
    <main className="subscription-page">
      <header className="subscription-header">
        <div>
          <Link to="/dashboard" className="subscription-back">← Back to dashboard</Link>
          <span className="subscription-kicker">Restaurant subscription</span>
          <h1>Plan and billing</h1>
          <p>Manage your ordered.food plan, free trial, payment method and billing schedule.</p>
        </div>
        {current?.status !== 'incomplete' && current && <button className="secondary-button" type="button" onClick={() => void openPortal()} disabled={busy === 'portal'}>{busy === 'portal' ? 'Opening…' : 'Manage billing'}</button>}
      </header>

      {searchParams.get('subscription') === 'success' && <div className="subscription-alert subscription-alert--success">Your Stripe checkout completed. Subscription status will update automatically.</div>}
      {searchParams.get('subscription') === 'cancelled' && <div className="subscription-alert">Checkout was cancelled. No subscription changes were made.</div>}
      {error && <div className="subscription-alert subscription-alert--error" role="alert">{error}</div>}

      {current && <section className={`subscription-current subscription-current--${current.status}`}>
        <div>
          <span className="subscription-status">{current.status.replaceAll('_', ' ')}</span>
          <h2>{current.plan.name}</h2>
          <p>{current.plan.description}</p>
        </div>
        <div className="subscription-current-details">
          <div><small>Billing</small><strong>{current.billing_interval === 'annual' ? 'Annual' : 'Monthly'}</strong></div>
          <div><small>{current.status === 'trialing' ? 'Trial ends' : 'Next billing date'}</small><strong>{formatDate(current.status === 'trialing' ? current.trial_ends_at : current.current_period_end)}</strong></div>
          <div><small>Price</small><strong>{formatMoney(current.billing_interval === 'annual' ? (current.plan.annual_price_pence || 0) : current.plan.monthly_price_pence)}<span>/{current.billing_interval === 'annual' ? 'year' : 'month'}</span></strong></div>
        </div>
        {current.status === 'trialing' && <div className="subscription-notice"><strong>{trialDays} day{trialDays === 1 ? '' : 's'} left in your trial.</strong> Billing begins automatically when the trial finishes.</div>}
        {current.status === 'past_due' && <div className="subscription-notice subscription-notice--danger"><strong>Payment failed.</strong> Update your payment method within {graceDays} day{graceDays === 1 ? '' : 's'} to avoid feature restrictions.</div>}
        {current.cancel_at_period_end && <div className="subscription-notice"><strong>Cancellation scheduled.</strong> Your access continues until {formatDate(current.current_period_end)}. You can reactivate from Manage billing.</div>}
      </section>}

      <section className="subscription-plans-heading">
        <div><span className="subscription-kicker">Available plans</span><h2>{current ? 'Compare or change plan' : 'Choose your plan'}</h2></div>
        <div className="billing-toggle" role="group" aria-label="Billing interval">
          <button type="button" className={interval === 'monthly' ? 'active' : ''} onClick={() => setInterval('monthly')}>Monthly</button>
          <button type="button" className={interval === 'annual' ? 'active' : ''} onClick={() => setInterval('annual')}>Annual <span>Save 2 months</span></button>
        </div>
      </section>

      <section className="subscription-plans">
        {(data?.plans ?? []).map((plan) => {
          const selected = current?.plan.id === plan.id
          const price = interval === 'annual' ? (plan.annual_price_pence || 0) : plan.monthly_price_pence
          return <article className={`subscription-plan ${selected ? 'subscription-plan--current' : ''}`} key={plan.id}>
            {selected && <span className="current-plan-label">Current plan</span>}
            <h3>{plan.name}</h3>
            <p>{plan.description}</p>
            <div className="subscription-price"><strong>{formatMoney(price)}</strong><span>/{interval === 'annual' ? 'year' : 'month'}</span></div>
            {!current && plan.trial_days > 0 && <small className="trial-label">Includes {plan.trial_days}-day free trial</small>}
            <ul>{Object.entries(plan.features).map(([key, value]) => {
              const label = featureLabel(key, value)
              return label ? <li key={key}>✓ {label}</li> : null
            })}</ul>
            {selected ? <button type="button" className="secondary-button" onClick={() => void openPortal()} disabled={busy === 'portal'}>Manage current plan</button> : current?.status === 'active' || current?.status === 'trialing' ? <button type="button" className="primary-button" onClick={() => void openPortal()} disabled={busy === 'portal'}>Change in billing portal</button> : <button type="button" className="primary-button" onClick={() => void startCheckout(plan)} disabled={Boolean(busy)}>{busy === plan.id ? 'Opening Stripe…' : `Choose ${plan.name}`}</button>}
          </article>
        })}
      </section>

      <section className="subscription-panel subscription-help">
        <div><h2>Billing and invoices</h2><p>Stripe securely manages cards, subscription invoices, plan changes and cancellations. No card details are stored by ordered.food.</p></div>
        {current && <button className="secondary-button" type="button" onClick={() => void openPortal()} disabled={busy === 'portal'}>Payment methods and invoices</button>}
      </section>
    </main>
  )
}
