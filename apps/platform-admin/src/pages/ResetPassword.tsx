import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type RecoveryState = 'checking' | 'ready' | 'invalid'

export default function ResetPassword() {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' && session) setRecoveryState('ready')
      if (event === 'SIGNED_OUT') setRecoveryState('invalid')
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setRecoveryState(data.session ? 'ready' : 'invalid')
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters for the new password.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      if (updateError.code === 'same_password') {
        setError('Your new password must be different from your current password.')
      } else if (updateError.code === 'weak_password') {
        setError('Choose a stronger password and try again.')
      } else {
        setError('We could not change your password. Request a new recovery link and try again.')
      }
      setLoading(false)
      return
    }

    await supabase.auth.signOut({ scope: 'global' })
    navigate('/login', { replace: true, state: { passwordReset: true } })
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-intro">
        <div className="admin-auth-logo"><span>o.</span>ordered.food</div>
        <div>
          <span className="admin-kicker">Secure recovery</span>
          <h1>Choose a new admin password.</h1>
          <p>After the password is changed, all current platform-admin sessions will be signed out for your protection.</p>
        </div>
        <small>Restricted access · Authorised administrators only</small>
      </section>

      <section className="admin-auth-panel">
        <div className="admin-auth-card">
          <span className="admin-kicker">Admin security</span>
          <h2>Set a new password</h2>
          {recoveryState === 'checking' && <div className="auth-recovery-check"><div className="gate-spinner" /><p>Checking your recovery link…</p></div>}
          {recoveryState === 'invalid' && <>
            <div className="admin-alert error" role="alert">This recovery link is invalid, expired or has already been used.</div>
            <div className="admin-auth-actions"><Link className="admin-primary-button" to="/forgot-password">Request a new link</Link><Link className="admin-auth-back" to="/login">Back to sign in</Link></div>
          </>}
          {recoveryState === 'ready' && <>
            <p>Create a password with at least 8 characters. Use a password that is unique to ordered.food.</p>
            <form className="admin-auth-form auth-recovery-form" onSubmit={submit}>
              <label>New password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required autoFocus /></label>
              <label>Confirm new password<input type="password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></label>
              {error && <div className="admin-alert error" role="alert">{error}</div>}
              <button className="admin-primary-button" type="submit" disabled={loading}>{loading ? 'Changing password…' : 'Change password'}</button>
            </form>
          </>}
        </div>
      </section>
    </main>
  )
}
