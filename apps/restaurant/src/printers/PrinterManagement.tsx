import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './PrinterManagement.css'

type WorkerStatus = 'offline' | 'online' | 'printing' | 'error'
type LiveStatus = 'connecting' | 'live' | 'offline'

type Printer = {
  id: string
  name: string
  printer_type: 'escpos' | 'epson' | 'star' | 'sunmi' | 'browser'
  connection_type: 'network' | 'usb' | 'bluetooth' | 'cloud' | 'browser'
  connection_config: Record<string, unknown>
  print_kitchen_tickets: boolean
  print_customer_receipts: boolean
  copies: number
  is_active: boolean
  worker_status: WorkerStatus
  last_seen_at: string | null
  last_printed_at: string | null
  last_error: string | null
  last_error_at: string | null
}

type FormState = {
  name: string
  printerType: Printer['printer_type']
  connectionType: Printer['connection_type']
  host: string
  port: string
  copies: string
  kitchen: boolean
  receipts: boolean
  active: boolean
}

const emptyForm: FormState = {
  name: '',
  printerType: 'escpos',
  connectionType: 'network',
  host: '',
  port: '9100',
  copies: '1',
  kitchen: true,
  receipts: false,
  active: true,
}

const STALE_AFTER_MS = 90_000

function effectiveStatus(printer: Printer): WorkerStatus {
  if (!printer.is_active || !printer.last_seen_at) return 'offline'
  if (Date.now() - new Date(printer.last_seen_at).getTime() > STALE_AFTER_MS) return 'offline'
  return printer.worker_status
}

function statusLabel(status: WorkerStatus) {
  if (status === 'online') return 'Online'
  if (status === 'printing') return 'Printing'
  if (status === 'error') return 'Error'
  return 'Offline'
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'Never'
  const difference = Date.now() - new Date(value).getTime()
  if (difference < 10_000) return 'Just now'
  if (difference < 60_000) return `${Math.floor(difference / 1_000)} seconds ago`
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} minutes ago`
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} hours ago`
  return new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function validNetworkHost(value: string) {
  const host = value.trim()
  if (!host || host.length > 253 || /\s|^https?:\/\//i.test(host)) return false
  const ipv4 = host.split('.')
  if (ipv4.length === 4) return ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)
}

function connectionHelp(type: Printer['connection_type']) {
  if (type === 'network') return 'Use a reserved local IP address. Most ESC/POS printers use port 9100.'
  if (type === 'usb') return 'USB printing requires the ordered.food print worker on a computer connected to the printer.'
  if (type === 'bluetooth') return 'Bluetooth printing requires the print worker and a printer paired to that device.'
  if (type === 'cloud') return 'Cloud printers must be configured with the manufacturer service before they can receive jobs.'
  return 'Browser printing opens the device print dialog and is intended for manual printing.'
}

export default function PrinterManagement() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [printers, setPrinters] = useState<Printer[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [, setClock] = useState(0)

  const loadPrinters = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setRefreshing(true)
    const { data, error: printersError } = await supabase
      .from('restaurant_printers')
      .select('id, name, printer_type, connection_type, connection_config, print_kitchen_tickets, print_customer_receipts, copies, is_active, worker_status, last_seen_at, last_printed_at, last_error, last_error_at')
      .eq('restaurant_id', id)
      .order('created_at', { ascending: true })
    if (!quiet) setRefreshing(false)
    if (printersError) throw printersError
    setPrinters((data ?? []) as Printer[])
  }, [])

  useEffect(() => {
    let active = true
    async function loadPage() {
      try {
        setLoading(true)
        setError('')
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          navigate('/login', { replace: true, state: { from: '/printers' } })
          return
        }
        const { data: membership, error: membershipError } = await supabase
          .from('restaurant_members')
          .select('restaurant_id, restaurants(name)')
          .eq('user_id', userData.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (membershipError) throw membershipError
        if (!membership) {
          navigate('/onboarding', { replace: true })
          return
        }
        if (!active) return
        const joined = membership.restaurants as { name: string } | { name: string }[] | null
        setRestaurantId(membership.restaurant_id)
        setRestaurantName(Array.isArray(joined) ? joined[0]?.name ?? 'Restaurant' : joined?.name ?? 'Restaurant')
        await loadPrinters(membership.restaurant_id, true)
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load printers.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadPage()
    return () => { active = false }
  }, [loadPrinters, navigate])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!restaurantId) return
    const channel = supabase
      .channel(`restaurant-printers:${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_printers', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void loadPrinters(restaurantId, true).catch(() => setLiveStatus('offline'))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveStatus('offline')
        else setLiveStatus('connecting')
      })
    return () => { void supabase.removeChannel(channel) }
  }, [loadPrinters, restaurantId])

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible' && restaurantId) {
        void loadPrinters(restaurantId, true).catch(() => setError('Unable to refresh printer status.'))
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [loadPrinters, restaurantId])

  const onlineCount = useMemo(() => printers.filter((printer) => ['online', 'printing'].includes(effectiveStatus(printer))).length, [printers])

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function editPrinter(printer: Printer) {
    setEditingId(printer.id)
    setError('')
    setMessage('')
    setForm({
      name: printer.name,
      printerType: printer.printer_type,
      connectionType: printer.connection_type,
      host: typeof printer.connection_config.host === 'string' ? printer.connection_config.host : '',
      port: String(typeof printer.connection_config.port === 'number' ? printer.connection_config.port : 9100),
      copies: String(printer.copies),
      kitchen: printer.print_kitchen_tickets,
      receipts: printer.print_customer_receipts,
      active: printer.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function savePrinter(event: FormEvent) {
    event.preventDefault()
    if (!restaurantId || saving || deletingId) return
    const copies = Number.parseInt(form.copies, 10)
    const port = Number.parseInt(form.port, 10)
    const host = form.host.trim()
    if (!form.name.trim()) return setError('Enter a name for this printer.')
    if (!form.kitchen && !form.receipts) return setError('Choose at least one document type for this printer.')
    if (form.connectionType === 'network' && !validNetworkHost(host)) return setError('Enter a valid local IP address or hostname without http:// or https://.')
    if (form.connectionType === 'network' && (!Number.isInteger(port) || port < 1 || port > 65535)) return setError('Port must be between 1 and 65535.')
    if (!Number.isInteger(copies) || copies < 1 || copies > 5) return setError('Copies must be between 1 and 5.')

    setSaving(true)
    setError('')
    setMessage('')
    const record = {
      restaurant_id: restaurantId,
      name: form.name.trim(),
      printer_type: form.printerType,
      connection_type: form.connectionType,
      connection_config: form.connectionType === 'network' ? { host, port, cut: true } : {},
      print_kitchen_tickets: form.kitchen,
      print_customer_receipts: form.receipts,
      copies,
      is_active: form.active,
      updated_at: new Date().toISOString(),
    }
    const result = editingId
      ? await supabase.from('restaurant_printers').update(record).eq('id', editingId).eq('restaurant_id', restaurantId).select('id').maybeSingle()
      : await supabase.from('restaurant_printers').insert(record).select('id').single()
    setSaving(false)
    if (result.error) return setError(result.error.message)
    if (!result.data) return setError('The printer changed on another device. Refresh and try again.')
    setMessage(editingId ? 'Printer updated.' : 'Printer added.')
    resetForm()
    await loadPrinters(restaurantId, true).catch(() => setError('Printer saved, but the list could not be refreshed.'))
  }

  async function testPrinter(printer: Printer) {
    if (!printer.is_active || testingId || saving || deletingId) return
    const status = effectiveStatus(printer)
    if (printer.connection_type !== 'browser' && status === 'offline') {
      setError('The print worker is offline. Start the worker and wait for this printer to show Online before testing.')
      return
    }
    setTestingId(printer.id)
    setError('')
    setMessage('')
    const { error: testError } = await supabase.rpc('queue_printer_test', { p_printer_id: printer.id })
    setTestingId(null)
    if (testError) return setError(testError.message)
    setMessage(`Test ticket queued for ${printer.name}. Check print history if it does not print.`)
  }

  async function deletePrinter(printer: Printer) {
    if (!restaurantId || deletingId || saving || testingId) return
    if (!window.confirm(`Delete ${printer.name}? Existing print history will be kept, but new jobs will no longer use it.`)) return
    setDeletingId(printer.id)
    setError('')
    setMessage('')
    const { data, error: deleteError } = await supabase
      .from('restaurant_printers')
      .delete()
      .eq('id', printer.id)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle()
    setDeletingId(null)
    if (deleteError) return setError(deleteError.message)
    if (!data) return setError('The printer was already changed or removed on another device.')
    if (editingId === printer.id) resetForm()
    setMessage('Printer deleted.')
    await loadPrinters(restaurantId, true).catch(() => setError('Printer deleted, but the list could not be refreshed.'))
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading printers…</div></main>

  return (
    <main className="portal-shell printers-page">
      <header className="portal-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{restaurantName} · Printers</p></div>
        <div className="print-history-header-actions"><Link className="secondary-button button-link" to="/print-history">Print history</Link><Link className="secondary-button button-link" to="/dashboard">Dashboard</Link></div>
      </header>

      <section className="page-heading-row">
        <div><span className="eyebrow">Kitchen operations</span><h1>Printer management</h1><p>Add printers, monitor the print worker and test every connection before service.</p></div>
        <div className="print-history-header-actions">
          <span className={`printer-status ${liveStatus === 'live' ? 'online' : liveStatus === 'offline' ? 'error' : 'printing'}`} role="status">{liveStatus === 'live' ? 'Live' : liveStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
          <button className="secondary-button" type="button" disabled={refreshing || !restaurantId} onClick={() => restaurantId && void loadPrinters(restaurantId).catch((caughtError) => setError(caughtError instanceof Error ? caughtError.message : 'Unable to refresh printers.'))}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </section>

      {printers.length > 0 && <p className="dashboard-kicker">{onlineCount} of {printers.length} active connections online</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}

      <section className="printer-layout">
        <form className="settings-card printer-form" onSubmit={(event) => void savePrinter(event)} aria-busy={saving}>
          <div className="settings-card-heading"><div><h2>{editingId ? 'Edit printer' : 'Add a printer'}</h2><p>{connectionHelp(form.connectionType)}</p></div></div>
          <div className="settings-field-grid">
            <label className="settings-field settings-field-wide"><span>Printer name</span><input className="standard-input" required maxLength={80} placeholder="Kitchen printer" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="settings-field"><span>Printer type</span><select className="standard-input" value={form.printerType} onChange={(event) => setForm({ ...form, printerType: event.target.value as Printer['printer_type'] })}><option value="escpos">ESC/POS</option><option value="epson">Epson ePOS</option><option value="star">Star Micronics</option><option value="sunmi">Sunmi</option><option value="browser">Browser printer</option></select></label>
            <label className="settings-field"><span>Connection</span><select className="standard-input" value={form.connectionType} onChange={(event) => setForm({ ...form, connectionType: event.target.value as Printer['connection_type'] })}><option value="network">Network</option><option value="usb">USB</option><option value="bluetooth">Bluetooth</option><option value="cloud">Cloud</option><option value="browser">Browser</option></select></label>
            {form.connectionType === 'network' && <><label className="settings-field"><span>IP address or hostname</span><input className="standard-input" autoCapitalize="none" autoCorrect="off" placeholder="192.168.1.120" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label><label className="settings-field"><span>Port</span><input className="standard-input" type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label></>}
            <label className="settings-field"><span>Copies</span><input className="standard-input" type="number" min="1" max="5" value={form.copies} onChange={(event) => setForm({ ...form, copies: event.target.value })} /></label>
          </div>
          <div className="printer-checks"><label><input type="checkbox" checked={form.kitchen} onChange={(event) => setForm({ ...form, kitchen: event.target.checked })} /> Kitchen tickets</label><label><input type="checkbox" checked={form.receipts} onChange={(event) => setForm({ ...form, receipts: event.target.checked })} /> Customer receipts</label><label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Printer active</label></div>
          <div className="printer-form-actions">{editingId && <button className="secondary-button" type="button" disabled={saving} onClick={resetForm}>Cancel</button>}<button className="primary-button" type="submit" disabled={saving || Boolean(deletingId)}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add printer'}</button></div>
        </form>

        <div className="printer-list">
          {printers.length === 0 ? <article className="settings-card printer-empty"><span className="printer-icon">▣</span><h2>No printers yet</h2><p>Add your first printer to automatically print paid orders.</p></article> : printers.map((printer) => {
            const status = effectiveStatus(printer)
            return <article className="settings-card printer-card" key={printer.id} aria-busy={testingId === printer.id || deletingId === printer.id}>
              <div className="printer-card-top"><div><span className={`printer-status ${status}`}><span className="printer-status-dot" aria-hidden="true" />{statusLabel(status)}</span><h2>{printer.name}</h2><p>{printer.printer_type.toUpperCase()} · {printer.connection_type}</p></div><strong>{printer.copies}×</strong></div>
              <div className="printer-health-grid"><div><span>Last seen</span><strong>{formatRelativeTime(printer.last_seen_at)}</strong></div><div><span>Last printed</span><strong>{formatRelativeTime(printer.last_printed_at)}</strong></div></div>
              {status === 'offline' && printer.is_active && printer.connection_type !== 'browser' && <div className="printer-error-panel"><strong>Print worker offline</strong><p>Start the ordered.food print worker on the device connected to this printer.</p></div>}
              {printer.last_error && <div className="printer-error-panel" role="alert"><strong>Latest printer error</strong><p>{printer.last_error}</p><span>{formatRelativeTime(printer.last_error_at)}</span></div>}
              <div className="printer-tags">{printer.print_kitchen_tickets && <span>Kitchen tickets</span>}{printer.print_customer_receipts && <span>Receipts</span>}{typeof printer.connection_config.host === 'string' && <span>{printer.connection_config.host}:{String(printer.connection_config.port ?? 9100)}</span>}</div>
              <div className="printer-card-actions"><button className="primary-button" type="button" disabled={!printer.is_active || Boolean(testingId) || Boolean(deletingId) || saving} onClick={() => void testPrinter(printer)}>{testingId === printer.id ? 'Queuing test…' : 'Print test ticket'}</button><button className="secondary-button" type="button" disabled={saving || Boolean(deletingId) || Boolean(testingId)} onClick={() => editPrinter(printer)}>Edit</button><button className="danger-text-button" type="button" disabled={saving || Boolean(deletingId) || Boolean(testingId)} onClick={() => void deletePrinter(printer)}>{deletingId === printer.id ? 'Deleting…' : 'Delete'}</button></div>
            </article>
          })}
        </div>
      </section>
    </main>
  )
}
