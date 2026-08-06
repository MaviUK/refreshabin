import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './StampPrograms.css'

type Reward = { id: string; name: string; reward_type: string; points_cost: number }
type Program = { id: string; name: string; description?: string | null; eligibility_type: 'order' | 'menu_item'; menu_item_id?: string | null; minimum_order_pence: number; stamps_per_qualifying_order: number; stamps_required: number; reward_id: string; reward_name: string; repeatable: boolean; card_expiry_days?: number | null; starts_at: string; ends_at?: string | null; is_active: boolean }
type Dashboard = { summary: { program_count: number; active_count: number; member_count: number; stamps_issued: number; completed_cards: number }; programs: Program[] }

const emptyForm = { id: '', name: '', description: '', eligibilityType: 'order', minimumSpend: '0', stampsPerOrder: '1', stampsRequired: '10', rewardId: '', repeatable: true, expiryDays: '', active: true }

export default function StampPrograms() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true); setError('')
    const [{ data, error: dashboardError }, { data: rewardsData, error: rewardsError }] = await Promise.all([
      supabase.rpc('get_restaurant_stamp_programs'),
      supabase.rpc('get_restaurant_loyalty_rewards'),
    ])
    if (dashboardError) setError(dashboardError.message)
    else setDashboard(data as Dashboard)
    if (rewardsError) setError((current) => current || rewardsError.message)
    else {
      const payload = rewardsData as { rewards?: Reward[] } | null
      setRewards(payload?.rewards || [])
      setForm((current) => ({ ...current, rewardId: current.rewardId || payload?.rewards?.[0]?.id || '' }))
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const activeRewards = useMemo(() => rewards.filter((reward) => reward.id), [rewards])

  function edit(program: Program) {
    setForm({ id: program.id, name: program.name, description: program.description || '', eligibilityType: program.eligibility_type, minimumSpend: String(program.minimum_order_pence / 100), stampsPerOrder: String(program.stamps_per_qualifying_order), stampsRequired: String(program.stamps_required), rewardId: program.reward_id, repeatable: program.repeatable, expiryDays: program.card_expiry_days ? String(program.card_expiry_days) : '', active: program.is_active })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.rpc('save_restaurant_stamp_program', {
      p_program_id: form.id || null,
      p_name: form.name,
      p_description: form.description || null,
      p_eligibility_type: form.eligibilityType,
      p_menu_item_id: null,
      p_minimum_order_pence: Math.round(Number(form.minimumSpend || 0) * 100),
      p_stamps_per_qualifying_order: Number(form.stampsPerOrder),
      p_stamps_required: Number(form.stampsRequired),
      p_reward_id: form.rewardId,
      p_repeatable: form.repeatable,
      p_card_expiry_days: form.expiryDays ? Number(form.expiryDays) : null,
      p_starts_at: new Date().toISOString(),
      p_ends_at: null,
      p_is_active: form.active,
    })
    if (saveError) setError(saveError.message)
    else { setMessage(form.id ? 'Stamp programme updated.' : 'Stamp programme created.'); setForm({ ...emptyForm, rewardId: activeRewards[0]?.id || '' }); await load() }
    setSaving(false)
  }

  if (loading) return <main className="stamp-page stamp-state">Loading stamp programmes…</main>

  const summary = dashboard?.summary || { program_count: 0, active_count: 0, member_count: 0, stamps_issued: 0, completed_cards: 0 }
  return <main className="stamp-page">
    <header className="stamp-header"><div><span>Loyalty</span><h1>Digital stamp cards</h1><p>Create repeat-visit campaigns and automatically issue rewards when customers complete a card.</p></div><nav><Link to="/loyalty">Points settings</Link><Link to="/loyalty/rewards">Rewards</Link></nav></header>
    {error && <p className="stamp-error">{error}</p>}{message && <p className="stamp-message">{message}</p>}
    <section className="stamp-stats"><article><span>Programmes</span><strong>{summary.program_count}</strong></article><article><span>Active</span><strong>{summary.active_count}</strong></article><article><span>Members</span><strong>{summary.member_count}</strong></article><article><span>Stamps issued</span><strong>{summary.stamps_issued}</strong></article><article><span>Cards completed</span><strong>{summary.completed_cards}</strong></article></section>
    <section className="stamp-layout">
      <form className="stamp-form" onSubmit={save}><div><span>{form.id ? 'Edit campaign' : 'New campaign'}</span><h2>{form.id ? form.name || 'Stamp programme' : 'Build a stamp card'}</h2></div>
        <label>Campaign name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label>Description<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="stamp-form-grid"><label>Stamps required<input type="number" min="2" max="100" value={form.stampsRequired} onChange={(event) => setForm({ ...form, stampsRequired: event.target.value })} required /></label><label>Stamps per order<input type="number" min="1" max="100" value={form.stampsPerOrder} onChange={(event) => setForm({ ...form, stampsPerOrder: event.target.value })} required /></label></div>
        <label>Minimum order (£)<input type="number" min="0" step="0.01" value={form.minimumSpend} onChange={(event) => setForm({ ...form, minimumSpend: event.target.value })} /></label>
        <label>Completion reward<select value={form.rewardId} onChange={(event) => setForm({ ...form, rewardId: event.target.value })} required><option value="">Choose a reward</option>{activeRewards.map((reward) => <option key={reward.id} value={reward.id}>{reward.name}</option>)}</select></label>
        {!activeRewards.length && <p className="stamp-hint">Create a reward before publishing a stamp card.</p>}
        <label>Card expiry in days <small>Optional</small><input type="number" min="1" max="3650" value={form.expiryDays} onChange={(event) => setForm({ ...form, expiryDays: event.target.value })} /></label>
        <label className="stamp-toggle"><input type="checkbox" checked={form.repeatable} onChange={(event) => setForm({ ...form, repeatable: event.target.checked })}/><span><strong>Repeatable campaign</strong><small>Start a new card automatically after completion.</small></span></label>
        <label className="stamp-toggle"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })}/><span><strong>Active</strong><small>Eligible completed orders earn stamps.</small></span></label>
        <div className="stamp-actions">{form.id && <button type="button" onClick={() => setForm({ ...emptyForm, rewardId: activeRewards[0]?.id || '' })}>Cancel edit</button>}<button type="submit" disabled={saving || !form.rewardId}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Create programme'}</button></div>
      </form>
      <section className="stamp-program-list"><div><span>Campaigns</span><h2>Current programmes</h2></div>{dashboard?.programs?.length ? dashboard.programs.map((program) => <article key={program.id}><div className="stamp-card-preview"><span>{program.name}</span><div>{Array.from({ length: Math.min(program.stamps_required, 12) }, (_, index) => <i key={index}>{index + 1}</i>)}</div><small>{program.stamps_required} stamps → {program.reward_name}</small></div><div className="stamp-program-meta"><span className={program.is_active ? 'active' : ''}>{program.is_active ? 'Active' : 'Paused'}</span><p>{program.description || `Earn ${program.stamps_per_qualifying_order} stamp${program.stamps_per_qualifying_order === 1 ? '' : 's'} per qualifying order.`}</p><button type="button" onClick={() => edit(program)}>Edit programme</button></div></article>) : <div className="stamp-empty">No stamp programmes yet.</div>}</section>
    </section>
  </main>
}
