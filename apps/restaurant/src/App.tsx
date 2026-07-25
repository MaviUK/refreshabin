import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './auth/Login'
import Register from './auth/Register'
import ForgotPassword from './auth/ForgotPassword'
import ResetPassword from './auth/ResetPassword'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './dashboard/Dashboard'
import Onboarding from './onboarding/Onboarding'

function HomeRedirect() {
  return <Navigate to="/dashboard" replace />
}

function ComingSoon({ title }: { title: string }) {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <span className="eyebrow">Coming next</span>
        <h1>{title}</h1>
        <p>This section is part of the next restaurant portal build phase.</p>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/dashboard"
        element={(
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/onboarding"
        element={(
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/menu"
        element={(
          <ProtectedRoute>
            <ComingSoon title="Menu builder" />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/opening-hours"
        element={(
          <ProtectedRoute>
            <ComingSoon title="Opening hours" />
          </ProtectedRoute>
        )}
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
