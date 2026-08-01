import { Navigate, Route, Routes } from 'react-router-dom'
import AdminGate from './components/AdminGate'
import AdminLayout from './components/AdminLayout'
import AuditLog from './pages/AuditLog'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Restaurants from './pages/Restaurants'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="audit" element={<AuditLog />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
