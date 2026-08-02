import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AdminGate from './components/AdminGate'
import AdminLayout, { useAdmin } from './components/AdminLayout'
import { supabase } from './lib/supabase'
import Admins from './pages/Admins'
import AuditLog from './pages/AuditLog'
import ForgotPassword from './pages/ForgotPassword'
import Login from './pages/Login'
import Overview from './pages/Overview'
import ResetPassword from './pages/ResetPassword'
import Restaurants from './pages/Restaurants'
import { hasAdminPermission, type AdminPermission } from './types'

function hasPasswordRecoveryParams() {
  return window.location.hash.includes('type=recovery') ||
    new URLSearchParams(window.location.search).get('type') === 'recovery'
}

export default function App() {
  const location = useLocation()

  // Older recovery emails return to the admin root with an implicit-flow token
  // in the URL fragment. Keep that fragment intact until Supabase has consumed
  // it; navigating before getSession() resolves discards the single-use token.
  if (hasPasswordRecoveryParams() && location.pathname !== '/reset-password') {
    return <RecoveryRedirect />
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="restaurants" element={<PermissionRoute permission="restaurants:view"><Restaurants /></PermissionRoute>} />
          <Route path="admins" element={<PermissionRoute permission="admins:view"><Admins /></PermissionRoute>} />
          <Route path="audit" element={<PermissionRoute permission="audit:view"><AuditLog /></PermissionRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function PermissionRoute({ permission, children }: { permission: AdminPermission; children: ReactNode }) {
  const { admin } = useAdmin()
  return hasAdminPermission(admin, permission) ? children : <Navigate to="/" replace />
}

function RecoveryRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true })
      }
    })

    // getSession waits for the client's URL-session initialization. Only then
    // is it safe to replace the URL and remove the recovery token fragment.
    void supabase.auth.getSession().then(() => {
      if (active) navigate('/reset-password', { replace: true })
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-intro">
        <div className="admin-auth-logo"><span>o.</span>ordered.food</div>
        <div>
          <span className="admin-kicker">Secure recovery</span>
          <h1>Checking your recovery link.</h1>
          <p>Please wait while we verify this single-use link.</p>
        </div>
        <small>Restricted access · Authorised administrators only</small>
      </section>
      <section className="admin-auth-panel">
        <div className="admin-auth-card auth-recovery-check">
          <div className="gate-spinner" />
          <p>Verifying securely…</p>
        </div>
      </section>
    </main>
  )
}
