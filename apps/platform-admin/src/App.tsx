import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AdminGate from './components/AdminGate'
import AdminLayout, { useAdmin } from './components/AdminLayout'
import { supabase } from './lib/supabase'
import Admins from './pages/Admins'
import Alerts from './pages/Alerts'
import Analytics from './pages/Analytics'
import AuditLog from './pages/AuditLog'
import Customers from './pages/Customers'
import ForgotPassword from './pages/ForgotPassword'
import Fees from './pages/Fees'
import Financials from './pages/Financials'
import GiftCards from './pages/GiftCards'
import StampCards from './pages/StampCards'
import Referrals from './pages/Referrals'
import Login from './pages/Login'
import Moderation from './pages/Moderation'
import OrderRecovery from './pages/OrderRecovery'
import Orders from './pages/Orders'
import Payments from './pages/Payments'
import Payouts from './pages/Payouts'
import Overview from './pages/Overview'
import ResetPassword from './pages/ResetPassword'
import RestaurantActivityPage from './pages/RestaurantActivityPage'
import Restaurants from './pages/Restaurants'
import ScheduledReports from './pages/ScheduledReports'
import SecurityRisk from './pages/SecurityRisk'
import Settings from './pages/Settings'
import Support from './pages/Support'
import SupportSla from './pages/SupportSla'
import { hasAdminPermission, type AdminPermission } from './types'

function hasPasswordRecoveryParams() {
  return window.location.hash.includes('type=recovery') ||
    new URLSearchParams(window.location.search).get('type') === 'recovery'
}

export default function App() {
  const location = useLocation()
  if (hasPasswordRecoveryParams() && location.pathname !== '/reset-password') return <RecoveryRedirect />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="analytics" element={<PermissionRoute permission="overview:view"><Analytics /></PermissionRoute>} />
          <Route path="stamp-cards" element={<PermissionRoute permission="overview:view"><StampCards /></PermissionRoute>} />
          <Route path="referrals" element={<PermissionRoute permission="overview:view"><Referrals /></PermissionRoute>} />
          <Route path="restaurants" element={<PermissionRoute permission="restaurants:view"><Restaurants /></PermissionRoute>} />
          <Route path="restaurant-activity" element={<PermissionRoute permission="restaurants:view"><RestaurantActivityPage /></PermissionRoute>} />
          <Route path="customers" element={<PermissionRoute permission="customers:view"><Customers /></PermissionRoute>} />
          <Route path="orders" element={<PermissionRoute permission="orders:view"><Orders /></PermissionRoute>} />
          <Route path="order-recovery" element={<PermissionRoute permission="orders:view"><OrderRecovery /></PermissionRoute>} />
          <Route path="support" element={<PermissionRoute permission="support:view"><Support /></PermissionRoute>} />
          <Route path="support-sla" element={<PermissionRoute permission="support:view"><SupportSla /></PermissionRoute>} />
          <Route path="moderation" element={<PermissionRoute permission="moderation:view"><Moderation /></PermissionRoute>} />
          <Route path="security-risk" element={<PermissionRoute permission="moderation:view"><SecurityRisk /></PermissionRoute>} />
          <Route path="payments" element={<PermissionRoute permission="finance:view"><Payments /></PermissionRoute>} />
          <Route path="payouts" element={<PermissionRoute permission="finance:view"><Payouts /></PermissionRoute>} />
          <Route path="gift-cards" element={<PermissionRoute permission="finance:view"><GiftCards /></PermissionRoute>} />
          <Route path="fees" element={<PermissionRoute permission="finance:view"><Fees /></PermissionRoute>} />
          <Route path="financials" element={<PermissionRoute permission="finance:view"><Financials /></PermissionRoute>} />
          <Route path="scheduled-reports" element={<PermissionRoute permission="finance:view"><ScheduledReports /></PermissionRoute>} />
          <Route path="alerts" element={<PermissionRoute permission="settings:view"><Alerts /></PermissionRoute>} />
          <Route path="settings" element={<PermissionRoute permission="settings:view"><Settings /></PermissionRoute>} />
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
      if (active && event === 'PASSWORD_RECOVERY') navigate('/reset-password', { replace: true })
    })
    void supabase.auth.getSession().then(() => { if (active) navigate('/reset-password', { replace: true }) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [navigate])

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-intro">
        <div className="admin-auth-logo"><span>o.</span>ordered.food</div>
        <div><span className="admin-kicker">Secure recovery</span><h1>Checking your recovery link.</h1><p>Please wait while we verify this single-use link.</p></div>
        <small>Restricted access · Authorised administrators only</small>
      </section>
      <section className="admin-auth-panel"><div className="admin-auth-card auth-recovery-check"><div className="gate-spinner" /><p>Verifying securely…</p></div></section>
    </main>
  )
}
