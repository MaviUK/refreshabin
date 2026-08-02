import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  adminRoleDescriptions,
  adminRoleLabels,
  formatDate,
  type AdminRole,
} from '../types'

const roles = Object.keys(adminRoleLabels) as AdminRole[]

type PlatformAdmin = {
  user_id: string
  email: string
  display_name: string
  role: AdminRole
  is_active: boolean
  created_at: string
  updated_at: string
  last_sign_in_at: string | null
  is_current: boolean
}

type AdminInvite = {
  id: string
  email: string
  role: AdminRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by_name: string | null
  created_at: string
  expires_at: string | null
  accepted_at: string | null
  revoked_at: string | null
}

type AdminSnapshot = {
  admins: PlatformAdmin[]
  invites: AdminInvite[]
}

type PendingAction = {
  userId: string
  email: string
  displayName: string
  action: 'change_role' | 'deactivate' | 'reactivate'
  role: AdminRole
  reason: string
}

export default function Admins() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({ admins: [], invites: [] })
  const [draftRoles, setDraftRoles] = useState<Record<string, AdminRole>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AdminRole>('operations')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_admins')
    if (loadError) {
      setError(loadError.message)
    } else {
      const next = (data ?? { admins: [], invites: [] }) as AdminSnapshot
      setSnapshot(next)
      setDraftRoles(Object.fromEntries(next.admins.map((admin) => [admin.user_id, admin.role])))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const pendingInvites = useMemo(
    () => snapshot.invites.filter((invite) => invite.status !== 'accepted'),
    [snapshot.invites],
  )

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    const { error: inviteError } = await supabase.rpc('invite_platform_admin', {
      p_email: inviteEmail.trim(),
      p_role: inviteRole,
      p_expires_in_days: 7,
    })

    if (inviteError) {
      setError(inviteError.message)
    } else {
      setMessage(`Access authorised for ${inviteEmail.trim()}. Share ordered.food/platform-admin/ so they can use First access.`)
      setInviteEmail('')
      setInviteRole('operations')
      await load()
    }
    setSaving(false)
  }

  function prepareAction(admin: PlatformAdmin, action: PendingAction['action']) {
    setError('')
    setMessage('')
    setPendingAction({
      userId: admin.user_id,
      email: admin.email,
      displayName: admin.display_name,
      action,
      role: action === 'change_role' ? draftRoles[admin.user_id] ?? admin.role : admin.role,
      reason: '',
    })
  }

  async function confirmAction() {
    if (!pendingAction) return
    if (pendingAction.action === 'deactivate' && !pendingAction.reason.trim()) {
      setError('Add a reason before deactivating administrator access.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const { error: actionError } = await supabase.rpc('manage_platform_admin', {
      p_user_id: pendingAction.userId,
      p_action: pendingAction.action,
      p_role: pendingAction.action === 'change_role' ? pendingAction.role : null,
      p_reason: pendingAction.reason.trim() || null,
    })

    if (actionError) {
      setError(actionError.message)
    } else {
      setMessage(actionSuccessMessage(pendingAction))
      setPendingAction(null)
      await load()
    }
    setSaving(false)
  }

  async function revokeInvite(invite: AdminInvite) {
    setSaving(true)
    setError('')
    setMessage('')
    const { error: revokeError } = await supabase.rpc('revoke_platform_admin_invite', {
      p_invite_id: invite.id,
    })
    if (revokeError) {
      setError(revokeError.message)
    } else {
      setMessage(`The invitation for ${invite.email} has been revoked.`)
      await load()
    }
    setSaving(false)
  }

  return (
    <div className="admin-page admin-access-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Security & permissions</span><h1>Admin access</h1><p>Authorise administrators, enforce their role and remove access without deleting the audit history.</p></div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || saving}>↻ Refresh</button>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {message && <div className="admin-alert success" role="status">{message}</div>}

      <section className="admin-role-grid" aria-label="Administrator role permissions">
        {roles.map((role) => (
          <article key={role} className={`admin-role-card ${role}`}>
            <span>{adminRoleLabels[role]}</span>
            <p>{adminRoleDescriptions[role]}</p>
          </article>
        ))}
      </section>

      <div className="admin-access-workspace">
        <section className="admin-panel admin-members-panel">
          <div className="panel-heading"><div><h2>Administrators</h2><p>{loading ? 'Loading access…' : `${snapshot.admins.length} administrator${snapshot.admins.length === 1 ? '' : 's'}`}</p></div></div>
          {loading && <div className="panel-empty">Loading administrators…</div>}
          {!loading && snapshot.admins.map((admin) => {
            const selectedRole = draftRoles[admin.user_id] ?? admin.role
            return (
              <article className={`admin-member-row ${admin.is_active ? '' : 'inactive'}`} key={admin.user_id}>
                <span className="admin-avatar">{admin.display_name.slice(0, 1).toUpperCase()}</span>
                <div className="admin-member-identity">
                  <div><strong>{admin.display_name}</strong>{admin.is_current && <span className="current-admin-badge">You</span>}</div>
                  <span>{admin.email}</span>
                  <small>{admin.last_sign_in_at ? `Last signed in ${formatDate(admin.last_sign_in_at)}` : 'No sign-in recorded'}</small>
                </div>
                <span className={`access-status ${admin.is_active ? 'active' : 'inactive'}`}>{admin.is_active ? 'Active' : 'Inactive'}</span>
                <div className="admin-member-controls">
                  <label>
                    <span>Role</span>
                    <select
                      value={selectedRole}
                      onChange={(event) => setDraftRoles((current) => ({ ...current, [admin.user_id]: event.target.value as AdminRole }))}
                      disabled={admin.is_current || saving}
                    >
                      {roles.map((role) => <option value={role} key={role}>{adminRoleLabels[role]}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={admin.is_current || selectedRole === admin.role || saving}
                    onClick={() => prepareAction(admin, 'change_role')}
                  >
                    Change role
                  </button>
                  {!admin.is_current && admin.is_active && <button type="button" className="danger-button ghost" disabled={saving} onClick={() => prepareAction(admin, 'deactivate')}>Deactivate</button>}
                  {!admin.is_current && !admin.is_active && <button type="button" className="admin-primary-button" disabled={saving} onClick={() => prepareAction(admin, 'reactivate')}>Reactivate</button>}
                </div>
              </article>
            )
          })}
        </section>

        <aside className="admin-access-side">
          <section className="admin-panel invite-admin-panel">
            <div className="panel-heading"><div><h2>Authorise an administrator</h2><p>First-access permission lasts seven days.</p></div></div>
            <form className="admin-invite-form" onSubmit={createInvite}>
              <label>Email address<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@ordered.food" required /></label>
              <label>Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as AdminRole)}>{roles.map((role) => <option value={role} key={role}>{adminRoleLabels[role]}</option>)}</select></label>
              <p>{adminRoleDescriptions[inviteRole]}</p>
              <button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Authorise access'}</button>
              <small>After authorising, share <strong>ordered.food/platform-admin/</strong>. Account verification is delivered through Supabase Auth using your configured SMTP provider.</small>
            </form>
          </section>

          <section className="admin-panel admin-invites-panel">
            <div className="panel-heading"><div><h2>Invitation history</h2><p>Pending, expired and revoked access.</p></div></div>
            {pendingInvites.length === 0 && <div className="panel-empty compact"><strong>No outstanding invitations</strong></div>}
            {pendingInvites.map((invite) => (
              <article className="admin-invite-row" key={invite.id}>
                <div><strong>{invite.email}</strong><span>{adminRoleLabels[invite.role]}</span><small>{invite.status === 'pending' && invite.expires_at ? `Expires ${formatDate(invite.expires_at)}` : `${capitalise(invite.status)} · ${formatDate(invite.revoked_at ?? invite.expires_at ?? invite.created_at)}`}</small></div>
                <span className={`invite-status ${invite.status}`}>{capitalise(invite.status)}</span>
                {invite.status === 'pending' && <button type="button" className="text-danger-button" disabled={saving} onClick={() => void revokeInvite(invite)}>Revoke</button>}
              </article>
            ))}
          </section>
        </aside>
      </div>

      {pendingAction && <section className="admin-access-confirmation" aria-live="polite">
        <div><span className="admin-kicker">Confirm sensitive action</span><h2>{actionTitle(pendingAction)}</h2><p>{actionDescription(pendingAction)}</p></div>
        <label>Reason {pendingAction.action === 'deactivate' ? '(required)' : '(optional)'}<textarea rows={3} value={pendingAction.reason} onChange={(event) => setPendingAction({ ...pendingAction, reason: event.target.value })} placeholder="Saved permanently in the audit log…" /></label>
        <div className="confirmation-buttons"><button type="button" className="secondary-button" disabled={saving} onClick={() => setPendingAction(null)}>Cancel</button><button type="button" className={pendingAction.action === 'deactivate' ? 'danger-button' : 'admin-primary-button'} disabled={saving} onClick={() => void confirmAction()}>{saving ? 'Saving…' : 'Confirm'}</button></div>
      </section>}
    </div>
  )
}

function actionTitle(action: PendingAction) {
  if (action.action === 'change_role') return `Change ${action.displayName} to ${adminRoleLabels[action.role]}?`
  if (action.action === 'deactivate') return `Deactivate ${action.displayName}?`
  return `Reactivate ${action.displayName}?`
}

function actionDescription(action: PendingAction) {
  if (action.action === 'change_role') return 'The new database permissions take effect on the administrator’s next request.'
  if (action.action === 'deactivate') return 'Their platform-admin access will stop immediately. Their Auth account and audit history are preserved.'
  return `This restores ${adminRoleLabels[action.role]} access to the platform-admin application.`
}

function actionSuccessMessage(action: PendingAction) {
  if (action.action === 'change_role') return `${action.displayName} is now ${adminRoleLabels[action.role]}.`
  if (action.action === 'deactivate') return `${action.displayName}'s administrator access has been deactivated.`
  return `${action.displayName}'s administrator access has been restored.`
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
