import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'
import './CustomerProfile.css'

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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

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

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')

    if (newPassword.length < 8) {
      setPasswordError('Your new password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }
    if (currentPassword === newPassword) {
      setPasswordError('Choose a different password from your current one.')
      return
    }

    setChangingPassword(true)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user?.email) {
      setChangingPassword(false)
      navigate('/account/login', { replace: true, state: { from: '/account/profile' } })
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (signInError) {
      setChangingPassword(false)
      setPasswordError('Your current password is incorrect.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (updateError) {
      setPasswordError(updateError.message)
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordMessage('Your password has been changed.')
  }

  if (loading) return <main className="customer-account-shell"><section className="customer-account-card customer-account-card--narrow"><p>Loading your details…</p></section></main>

  return (
    <main className="customer-account-shell customer-account-shell--settings">
      <div className="customer-settings-stack">
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

        <section className="customer-account-card customer-account-card--narrow">
          <span className="customer-account-eyebrow">Security</span>
          <h2>Change password</h2>
          <p>Confirm your current password before choosing a new one.</p>
          <form className="customer-account-form" onSubmit={handlePasswordChange}>
            <label>
              Current password
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <label>
              New password
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
              <span>At least 8 characters</span>
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            {passwordError && <div className="customer-account-error" role="alert">{passwordError}</div>}
            {passwordMessage && <div className="customer-account-success" role="status">{passwordMessage}</div>}
            <button type="submit" disabled={changingPassword}>{changingPassword ? 'Changing password…' : 'Change password'}</button>
          </form>
        </section>
      </div>
    </main>
  )
}
