import { FormEvent, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

function safeDestination(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account'
  return value
}

export default function CustomerRegister() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)

  const destination = useMemo(() => {
    const stateDestination = (location.state as { from?: string } | null)?.from
    return safeDestination(stateDestination || searchParams.get('redirect'))
  }, [location.state, searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Your passwords do not match.')
      return
    }

    setLoading(true)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          account_type: 'customer',
        },
      },
    })

    if (signUpError) {
      setLoading(false)
      setError(signUpError.message)
      return
    }

    if (!data.session || !data.user) {
      setLoading(false)
      setConfirmationSent(true)
      return
    }

    const { error: profileError } = await supabase.from('customer_profiles').upsert({
      user_id: data.user.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      updated_at: new Date().toISOString(),
    })

    setLoading(false)
    if (profileError) {
      setError(profileError.message)
      return
    }

    navigate(destination, { replace: true })
  }

  if (confirmationSent) {
    return (
      <main className="customer-account-shell">
        <section className="customer-account-card customer-account-card--narrow">
          <Link className="customer-account-brand" to="/">ordered.food</Link>
          <span className="customer-account-eyebrow">Customer account</span>
          <h1>Check your email</h1>
          <p>We sent a confirmation link to <strong>{email.trim()}</strong>. Open it to finish creating your account.</p>
          <Link className="customer-account-secondary" to="/account/login" state={{ from: destination }}>Return to sign in</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="customer-account-shell">
      <section className="customer-account-card customer-account-card--narrow">
        <Link className="customer-account-brand" to="/">ordered.food</Link>
        <span className="customer-account-eyebrow">Customer account</span>
        <h1>Create your account</h1>
        <p>Save favourites and addresses, track orders and order again more quickly.</p>

        <form className="customer-account-form" onSubmit={handleSubmit}>
          <label>
            First name
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required />
          </label>
          <label>
            Last name
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required />
          </label>
          <label>
            Email address
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            Mobile number <span>Optional</span>
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
          </label>
          <label>
            Password
            <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
            <span>At least 8 characters</span>
          </label>
          <label>
            Confirm password
            <input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          {error && <div className="customer-account-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
        </form>

        <p className="customer-account-note">Already registered? <Link to="/account/login" state={{ from: destination }}>Sign in</Link></p>
      </section>
    </main>
  )
}
