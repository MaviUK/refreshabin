import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type ConnectStatus = {
  restaurant_id: string
  stripe_account_id: string | null
  status: 'not_started' | 'pending' | 'restricted' | 'enabled'
  details_submitted: boolean
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements: {
    currently_due?: string[]
    eventually_due?: string[]
    past_due?: string[]
    disabled_reason?: string | null
  }
  updated_at: string | null
}

const labels: Record<ConnectStatus['status'], string> = {
  not_started: 'Connect your Stripe account',
  pending: 'Stripe setup in progress',
  restricted: 'More information required',
  enabled: 'Payments enabled',
}

export default function Payments() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'onboard' | 'dashboard' | 'refresh' | null>(null)
  const [error, setError] = useState('')
  const refreshId = useRef(0)

  const invoke = useCallback(async (action: 'status' | 'onboard' | 'dashboard') => {
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-stripe-connect', {
      body: { action },
    })
    if (invokeError) throw invokeError
    if (data?.error) throw new Error(data.error)
    return data
  }, [])

  const refresh = useCallback(async () => {
    const requestId = ++refreshId.current
    setBusy('refresh')
    setError('')
    try {
      const data = await invoke('status')
      if (requestId !== refreshId.current) return
      setStatus(data as ConnectStatus)
      setError('')
    } catch (caught) {
      if (requestId !== refreshId.current) return
      setError(caught instanceof Error ? caught.message : 'Unable to load payment status.')
    } finally {
      if (requestId === refreshId.current) {
        setBusy(null)
        setLoading(false)
      }
    }
  }, [invoke])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!searchParams.get('stripe')) return
    const next = new URLSearchParams(searchParams)
    next.delete('stripe')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  async function openStripe(action: 'onboard' | 'dashboard') {
    setBusy(action)
    setError('')
    try {
      const data = await invoke(action)
      if (!data?.url) throw new Error('Stripe did not return a secure link.')
      window.location.assign(data.url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open Stripe.')
      setBusy(null)
    }
  }

  const due = status?.requirements?.currently_due ?? []
  const enabled = Boolean(status?.charges_enabled && status?.payouts_enabled)

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px 64px' }}>
      {enabled && <Link to="/dashboard">← Back to dashboard</Link>}
      <p style={{ marginTop: enabled ? 28 : 0, fontWeight: 700, color: '#6b3f86' }}>
        {enabled ? 'Setup complete' : 'Application approved · One final step'}
      </p>
      <h1>{enabled ? 'You are ready to take payments' : 'Connect Stripe'}</h1>
      <p>
        {enabled
          ? 'Your restaurant can receive customer payments and Stripe can pay out your share automatically.'
          : 'Before your restaurant can go live, connect Stripe and complete the secure business and bank verification.'}
      </p>

      {error && <div className="error-message" role="alert">{error}</div>}
      {loading ? <p>Loading payment status…</p> : status && (
        <>
          <section className="card" style={{ padding: 24, marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <small>Stripe Connect status</small>
                <h2 style={{ marginTop: 6 }}>{labels[status.status]}</h2>
                <p>
                  Application approved: <strong>Yes</strong><br />
                  Card payments: <strong>{status.charges_enabled ? 'Enabled' : 'Not enabled'}</strong><br />
                  Payouts: <strong>{status.payouts_enabled ? 'Enabled' : 'Not enabled'}</strong>
                </p>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={busy !== null}>
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh status'}
              </button>
            </div>

            {status.updated_at && <p><small>Last checked {new Date(status.updated_at).toLocaleString('en-GB')}</small></p>}

            {!enabled && (
              <button type="button" onClick={() => void openStripe('onboard')} disabled={busy !== null}>
                {busy === 'onboard' ? 'Opening Stripe…' : status.stripe_account_id ? 'Continue Stripe setup' : 'Connect with Stripe'}
              </button>
            )}
            {status.details_submitted && (
              <button type="button" onClick={() => void openStripe('dashboard')} disabled={busy !== null} style={{ marginLeft: enabled ? 0 : 12 }}>
                {busy === 'dashboard' ? 'Opening dashboard…' : 'Open Stripe dashboard'}
              </button>
            )}
            {enabled && (
              <Link to="/dashboard" className="button" style={{ display: 'inline-block', marginLeft: 12 }}>
                Continue to dashboard
              </Link>
            )}
          </section>

          {due.length > 0 && (
            <section className="card" style={{ padding: 24, marginTop: 20 }}>
              <h2>Information still required</h2>
              <ul>{due.map((item) => <li key={item}>{item.replaceAll('.', ' › ').replaceAll('_', ' ')}</li>)}</ul>
            </section>
          )}

          <section className="card" style={{ padding: 24, marginTop: 20 }}>
            <h2>How payments work</h2>
            <p>Customers pay through ordered.food. Your restaurant share is transferred to this connected Stripe account, while the platform retains its configured commission and any customer service fee.</p>
          </section>
        </>
      )}
    </main>
  )
}
