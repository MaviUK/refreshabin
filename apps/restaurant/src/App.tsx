import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './auth/Login'
import Register from './auth/Register'
import ForgotPassword from './auth/ForgotPassword'
import ResetPassword from './auth/ResetPassword'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './dashboard/Dashboard'
import Onboarding from './onboarding/Onboarding'
import MenuBuilder from './menu/MenuBuilder'
import OpeningHours from './opening-hours/OpeningHours'
import Branding from './branding/Branding'

function HomeRedirect() {
  return <Navigate to="/dashboard" replace />
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
            <MenuBuilder />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/opening-hours"
        element={(
          <ProtectedRoute>
            <OpeningHours />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/branding"
        element={(
          <ProtectedRoute>
            <Branding />
          </ProtectedRoute>
        )}
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
