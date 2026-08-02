import type { CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { adminRoleLabels, hasAdminPermission, type AdminPermission } from '../types'
import type { AdminOutletContext } from './AdminGate'

const navItems: Array<{ to: string; label: string; icon: string; end: boolean; permission: AdminPermission }> = [
  { to: '/', label: 'Overview', icon: '⌂', end: true, permission: 'overview:view' },
  { to: '/restaurants', label: 'Restaurants', icon: '▣', end: false, permission: 'restaurants:view' },
  { to: '/orders', label: 'Orders', icon: '◎', end: false, permission: 'orders:view' },
  { to: '/support', label: 'Support', icon: '◇', end: false, permission: 'support:view' },
  { to: '/payments', label: 'Payments', icon: '¤', end: false, permission: 'finance:view' },
  { to: '/financials', label: 'Financials', icon: '▤', end: false, permission: 'finance:view' },
  { to: '/fees', label: 'Fees', icon: '£', end: false, permission: 'finance:view' },
  { to: '/admins', label: 'Admin access', icon: '♙', end: false, permission: 'admins:view' },
  { to: '/audit', label: 'Audit log', icon: '↻', end: false, permission: 'audit:view' },
]

export function useAdmin() {
  return useOutletContext<AdminOutletContext>()
}

export default function AdminLayout() {
  const { admin } = useOutletContext<AdminOutletContext>()
  const navigate = useNavigate()
  const visibleNavItems = navItems.filter((item) => hasAdminPermission(admin, item.permission))

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
          {visibleNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-account">
          <span className="admin-avatar">{admin.display_name.slice(0, 1).toUpperCase()}</span>
          <span><strong>{admin.display_name}</strong><small>{adminRoleLabels[admin.role]}</small></span>
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

      <nav
        className="mobile-admin-nav"
        aria-label="Platform administration"
        style={{ '--admin-nav-count': visibleNavItems.length } as CSSProperties}
      >
        {visibleNavItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
