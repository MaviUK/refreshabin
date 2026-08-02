import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import AdminGate from './components/AdminGate'
import AdminLayout from './components/AdminLayout'
import { hasPasswordRecoveryParams, supabase } from './lib/supabase'
import AuditLog from './pages/AuditLog'
import ForgotPassword from './pages/ForgotPassword'
import Login from './pages/Login'
import Overview from './pages/Overview'
import ResetPassword from './pages/ResetPassword'
import Restaurants from './pages/Restaurants'

export default function App() {
  return (
    <>
      <RecoveryRedirect />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<AdminGate />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Overview />} />
            <Route path="restaurants" element={<Restaurants />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

function RecoveryRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    if (hasPasswordRecoveryParams) navigate('/reset-password', { replace: true })

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') navigate('/reset-password', { replace: true })
    })

    return () => data.subscription.unsubscribe()
  }, [navigate])

  return null
}
