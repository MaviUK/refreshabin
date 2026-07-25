import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type DayHours = {
  day_of_week: number
  label: string
  is_closed: boolean
  open_time: string
  close_time: string
}

const defaultHours: DayHours[] = [
  { day_of_week: 1, label: 'Monday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 2, label: 'Tuesday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 3, label: 'Wednesday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 4, label: 'Thursday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 5, label: 'Friday', is_closed: false, open_time: '09:00', close_time: '23:00' },
  { day_of_week: 6, label: 'Saturday', is_closed: false, open_time: '09:00', close_time: '23:00' },
  { day_of_week: 0, label: 'Sunday', is_closed: false, open_time: '10:00', close_time: '21:00' },
]

export default function OpeningHours() {
  const [locationId, setLocationId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Your restaurant')
  const [hours, setHours] = useState<DayHours[]>(defaultHours)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadHours()
  }, [])

  async function loadHours() {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user

    if (!user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, restaurants(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }

    if (!membership) {
      setLoading(false)
      return
    }

    const restaurant = membership.restaurants as { name?: string } | null
    setRestaurantName(restaurant?.name || 'Your restaurant')

    const { data: location, error: locationError } = await supabase
      .from('restaurant_locations')
      .select('id')
      .eq('restaurant_id', membership.restaurant_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (locationError) {
      setError(locationError.message)
      setLoading(false)
      return
    }

    if (!location) {
      setLoading(false)
      return
    }

    setLocationId(location.id)

    const { data: storedHours, error: hoursError } = await supabase
      .from('opening_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('location_id', location.id)

    if (hoursError) {
      setError(hoursError.message)
    } else if (storedHours?.length) {
      setHours(defaultHours.map((day) => {
        const stored = storedHours.find((entry) => entry.day_of_week === day.day_of_week)
        return stored
          ? {
              ...day,
              is_closed: stored.is_closed,
              open_time: stored.open_time?.slice(0, 5) || day.open_time,
              close_time: stored.close_time?.slice(0, 5) || day.close_time,
            }
          : day
      }))
    }

    setLoading(false)
  }

  function updateDay(dayOfWeek: number, patch: Partial<DayHours>) {
    setSaved(false)
    setHours((current) => current.map((day) => (
      day.day_of_week === dayOfWeek ? { ...day, ...patch } : day
    )))
  }

  function copyMondayToWeekdays() {
    const monday = hours.find((day) => day.day_of_week === 1)
    if (!monday) return

    setSaved(false)
    setHours((current) => current.map((day) => (
      day.day_of_week >= 1 && day.day_of_week <= 5
        ? { ...day, is_closed: monday.is_closed, open_time: monday.open_time, close_time: monday.close_time }
        : day
    )))
  }

  async function saveHours() {
    if (!locationId) return

    const invalidDay = hours.find((day) => !day.is_closed && day.open_time === day.close_time)
    if (invalidDay) {
      setError(`${invalidDay.label} must have different opening and closing times.`)
      return
    }

    setSaving(true)
    setSaved(false)
    setError('')

    const rows = hours.map((day) => ({
      location_id: locationId,
      day_of_week: day.day_of_week,
      is_closed: day.is_closed,
      open_time: day.is_closed ? null : day.open_time,
      close_time: day.is_closed ? null : day.close_time,
      updated_at: new Date().toISOString(),
    }))

    const { error: saveError } = await supabase
      .from('opening_hours')
      .upsert(rows, { onConflict: 'location_id,day_of_week' })

    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setSaved(true)
  }

  if (loading) {
    return <main className="hours-shell"><div className="menu-state-card">Loading opening hours…</div></main>
  }

  if (!locationId) {
    return (
      <main className="hours-shell">
        <div className="menu-state-card">
          <span className="eyebrow">Opening hours</span>
          <h1>Create your restaurant first.</h1>
          <p>Complete the restaurant setup before setting your trading hours.</p>
          <Link className="primary-button button-link" to="/onboarding">Start setup</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="hours-shell">
      <header className="menu-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurantName} · Opening hours</p>
        </div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="hours-card">
        <div className="hours-heading">
          <div>
            <span className="eyebrow">Trading times</span>
            <h1>When are you open?</h1>
            <p>Customers will only be able to place orders during these times.</p>
          </div>
          <button className="secondary-button" type="button" onClick={copyMondayToWeekdays}>Copy Monday to weekdays</button>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        {saved && <div className="form-success" role="status">Opening hours saved.</div>}

        <div className="hours-list">
          {hours.map((day) => (
            <div className={day.is_closed ? 'hours-row closed' : 'hours-row'} key={day.day_of_week}>
              <div className="hours-day">
                <strong>{day.label}</strong>
                <label className="closed-toggle">
                  <input
                    type="checkbox"
                    checked={day.is_closed}
                    onChange={(event) => updateDay(day.day_of_week, { is_closed: event.target.checked })}
                  />
                  Closed
                </label>
              </div>

              <div className="time-fields">
                <label>
                  Opens
                  <input
                    type="time"
                    value={day.open_time}
                    disabled={day.is_closed}
                    onChange={(event) => updateDay(day.day_of_week, { open_time: event.target.value })}
                  />
                </label>
                <span>to</span>
                <label>
                  Closes
                  <input
                    type="time"
                    value={day.close_time}
                    disabled={day.is_closed}
                    onChange={(event) => updateDay(day.day_of_week, { close_time: event.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="hours-actions">
          <Link className="text-button button-link" to="/dashboard">Cancel</Link>
          <button className="primary-button" type="button" onClick={saveHours} disabled={saving}>
            {saving ? 'Saving…' : 'Save opening hours'}
          </button>
        </div>
      </section>
    </main>
  )
}
