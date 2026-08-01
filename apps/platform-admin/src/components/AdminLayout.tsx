import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AdminOutletContext } from './AdminGate'

const navItems = [
  { to: '/', label: 'Overview', icon: '⌂', end: true },
  { to: '/restaurants', label: 'Restaurants', icon: '▣', end: false },
  { to: '/audit', label: 'Audit log', icon: '↻', end: false },
]

export function useAdmin() {
  return useOutletContext<AdminOutletContext>()
}

export default function AdminLayout() {
  const { admin } = useOutletContext<AdminOutletContext>()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">o.</span>
          <span><strong>ordered.food</strong><small>Platform admin</small></span>
        </div>

        <nav className="admin-nav" aria-label="Platform administration">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-account">
          <span className="admin-avatar">{admin.display_name.slice(0, 1).toUpperCase()}</span>
          <span><strong>{admin.display_name}</strong><small>{admin.role.replace('_', ' ')}</small></span>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out">↗</button>
        </div>
      </aside>

      <main className="admin-content">
        <header className="mobile-admin-header">
          <div className="admin-brand"><span className="admin-brand-mark">o.</span><strong>Admin</strong></div>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </header>
        <Outlet context={{ admin } satisfies AdminOutletContext} />
      </main>

      <nav className="mobile-admin-nav" aria-label="Platform administration">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
