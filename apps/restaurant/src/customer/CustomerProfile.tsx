import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

type ProfileForm = {
  firstName: string
  lastName: string
  phone: string
  email: string
}

export default function CustomerProfile() {
  const navigate = useNavigate()
  const [form, setForm] = useState<ProfileForm>({ firstName: '', lastName: '', phone: '', email: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function loadProfile() {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        navigate('/account/login', { replace: true, state: { from: '/account/profile' } })
        return
      }

      const { data, error: profileError } = await supabase
        .from('customer_profiles')
        .select('first_name,last_name,phone')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profileError) setError(profileError.message)
      setForm({
        firstName: data?.first_name || '',
        lastName: data?.last_name || '',
        phone: data?.phone || '',
        email: user.email || '',
      })
      setLoading(false)
    }

    void loadProfile()
  }, [navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      setSaving(false)
      navigate('/account/login', { replace: true, state: { from: '/account/profile' } })
      return
    }

    const { error: profileError } = await supabase.from('customer_profiles').upsert({
      user_id: data.user.id,
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      phone: form.phone.trim() || null,
      updated_at: new Date().toISOString(),
    })

    setSaving(false)
    if (profileError) setError(profileError.message)
    else setMessage('Your details have been updated.')
  }

  if (loading) return <main className="customer-account-shell"><section className="customer-account-card customer-account-card--narrow"><p>Loading your details…</p></section></main>

  return (
    <main className="customer-account-shell">
      <section className="customer-account-card customer-account-card--narrow">
        <Link className="customer-account-brand" to="/account">← My account</Link>
        <span className="customer-account-eyebrow">Account settings</span>
        <h1>Your details</h1>
        <p>Keep your contact details up to date for future orders.</p>

        <form className="customer-account-form" onSubmit={handleSubmit}>
          <label>
            First name
            <input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} autoComplete="given-name" required />
          </label>
          <label>
            Last name
            <input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} autoComplete="family-name" required />
          </label>
          <label>
            Email address
            <input type="email" value={form.email} disabled />
            <span>Your sign-in email cannot be changed here.</span>
          </label>
          <label>
            Mobile number
            <input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} autoComplete="tel" />
          </label>
          {error && <div className="customer-account-error" role="alert">{error}</div>}
          {message && <div className="customer-account-success" role="status">{message}</div>}
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </form>
      </section>
    </main>
  )
}
