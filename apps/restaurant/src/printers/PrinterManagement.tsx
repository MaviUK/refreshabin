import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './PrinterManagement.css'

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

export default function PrinterManagement() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [printers, setPrinters] = useState<Printer[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadPage()
  }, [])

  async function loadPage() {
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

    const joined = membership.restaurants as { name: string } | { name: string }[] | null
    setRestaurantId(membership.restaurant_id)
    setRestaurantName(Array.isArray(joined) ? joined[0]?.name ?? 'Restaurant' : joined?.name ?? 'Restaurant')
    await loadPrinters(membership.restaurant_id)
    setLoading(false)
  }

  async function loadPrinters(id: string) {
    const { data, error: printersError } = await supabase
      .from('restaurant_printers')
      .select('id, name, printer_type, connection_type, connection_config, print_kitchen_tickets, print_customer_receipts, copies, is_active')
      .eq('restaurant_id', id)
      .order('created_at', { ascending: true })

    if (printersError) {
      setError(printersError.message)
      return
    }

    setPrinters((data ?? []) as Printer[])
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function editPrinter(printer: Printer) {
    setEditingId(printer.id)
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
    if (!restaurantId) return

    const copies = Number.parseInt(form.copies, 10)
    const port = Number.parseInt(form.port, 10)

    if (!form.name.trim()) {
      setError('Enter a name for this printer.')
      return
    }

    if (!form.kitchen && !form.receipts) {
      setError('Choose at least one document type for this printer.')
      return
    }

    if (form.connectionType === 'network' && !form.host.trim()) {
      setError('Enter the printer IP address.')
      return
    }

    if (!Number.isInteger(copies) || copies < 1 || copies > 5) {
      setError('Copies must be between 1 and 5.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    const record = {
      restaurant_id: restaurantId,
      name: form.name.trim(),
      printer_type: form.printerType,
      connection_type: form.connectionType,
      connection_config: form.connectionType === 'network'
        ? { host: form.host.trim(), port: Number.isInteger(port) ? port : 9100, cut: true }
        : {},
      print_kitchen_tickets: form.kitchen,
      print_customer_receipts: form.receipts,
      copies,
      is_active: form.active,
      updated_at: new Date().toISOString(),
    }

    const result = editingId
      ? await supabase.from('restaurant_printers').update(record).eq('id', editingId).eq('restaurant_id', restaurantId)
      : await supabase.from('restaurant_printers').insert(record)

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setMessage(editingId ? 'Printer updated.' : 'Printer added.')
    resetForm()
    await loadPrinters(restaurantId)
  }

  async function testPrinter(printer: Printer) {
    if (!printer.is_active || testingId) return

    setTestingId(printer.id)
    setError('')
    setMessage('')

    const { error: testError } = await supabase.rpc('queue_printer_test', {
      p_printer_id: printer.id,
    })

    setTestingId(null)

    if (testError) {
      setError(testError.message)
      return
    }

    setMessage(`Test ticket queued for ${printer.name}.`)
  }

  async function deletePrinter(printer: Printer) {
    if (!restaurantId || !window.confirm(`Delete ${printer.name}?`)) return

    const { error: deleteError } = await supabase
      .from('restaurant_printers')
      .delete()
      .eq('id', printer.id)
      .eq('restaurant_id', restaurantId)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setMessage('Printer deleted.')
    await loadPrinters(restaurantId)
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading printers…</div></main>

  if (!restaurantId) {
    return (
      <main className="portal-shell">
        <div className="menu-state-card">
          <span className="eyebrow">Printing</span>
          <h1>Create your restaurant first.</h1>
          <p>Complete restaurant setup before adding kitchen printers.</p>
          <Link className="primary-button button-link" to="/onboarding">Start setup</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="portal-shell printers-page">
      <header className="portal-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurantName} · Printers</p>
        </div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="page-heading-row">
        <div>
          <span className="eyebrow">Kitchen operations</span>
          <h1>Printer management</h1>
          <p>Add kitchen and receipt printers, then choose what each one should print.</p>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}

      <section className="printer-layout">
        <form className="settings-card printer-form" onSubmit={(event) => void savePrinter(event)}>
          <div className="settings-card-heading">
            <div>
              <h2>{editingId ? 'Edit printer' : 'Add a printer'}</h2>
              <p>Most Ethernet kitchen printers use ESC/POS on port 9100.</p>
            </div>
          </div>

          <div className="settings-field-grid">
            <label className="settings-field settings-field-wide">
              <span>Printer name</span>
              <input className="standard-input" placeholder="Kitchen printer" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>

            <label className="settings-field">
              <span>Printer type</span>
              <select className="standard-input" value={form.printerType} onChange={(event) => setForm({ ...form, printerType: event.target.value as Printer['printer_type'] })}>
                <option value="escpos">ESC/POS</option>
                <option value="epson">Epson ePOS</option>
                <option value="star">Star Micronics</option>
                <option value="sunmi">Sunmi</option>
                <option value="browser">Browser printer</option>
              </select>
            </label>

            <label className="settings-field">
              <span>Connection</span>
              <select className="standard-input" value={form.connectionType} onChange={(event) => setForm({ ...form, connectionType: event.target.value as Printer['connection_type'] })}>
                <option value="network">Network</option>
                <option value="usb">USB</option>
                <option value="bluetooth">Bluetooth</option>
                <option value="cloud">Cloud</option>
                <option value="browser">Browser</option>
              </select>
            </label>

            {form.connectionType === 'network' && (
              <>
                <label className="settings-field">
                  <span>IP address</span>
                  <input className="standard-input" inputMode="decimal" placeholder="192.168.1.120" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
                </label>
                <label className="settings-field">
                  <span>Port</span>
                  <input className="standard-input" type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} />
                </label>
              </>
            )}

            <label className="settings-field">
              <span>Copies</span>
              <input className="standard-input" type="number" min="1" max="5" value={form.copies} onChange={(event) => setForm({ ...form, copies: event.target.value })} />
            </label>
          </div>

          <div className="printer-checks">
            <label><input type="checkbox" checked={form.kitchen} onChange={(event) => setForm({ ...form, kitchen: event.target.checked })} /> Kitchen tickets</label>
            <label><input type="checkbox" checked={form.receipts} onChange={(event) => setForm({ ...form, receipts: event.target.checked })} /> Customer receipts</label>
            <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Printer active</label>
          </div>

          <div className="printer-form-actions">
            {editingId && <button className="secondary-button" type="button" onClick={resetForm}>Cancel</button>}
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add printer'}</button>
          </div>
        </form>

        <div className="printer-list">
          {printers.length === 0 ? (
            <article className="settings-card printer-empty">
              <span className="printer-icon">▣</span>
              <h2>No printers yet</h2>
              <p>Add your first printer to automatically print paid orders.</p>
            </article>
          ) : printers.map((printer) => (
            <article className="settings-card printer-card" key={printer.id}>
              <div className="printer-card-top">
                <div>
                  <span className={printer.is_active ? 'printer-status active' : 'printer-status'}>{printer.is_active ? 'Active' : 'Inactive'}</span>
                  <h2>{printer.name}</h2>
                  <p>{printer.printer_type.toUpperCase()} · {printer.connection_type}</p>
                </div>
                <strong>{printer.copies}×</strong>
              </div>
              <div className="printer-tags">
                {printer.print_kitchen_tickets && <span>Kitchen tickets</span>}
                {printer.print_customer_receipts && <span>Receipts</span>}
                {typeof printer.connection_config.host === 'string' && <span>{printer.connection_config.host}:{String(printer.connection_config.port ?? 9100)}</span>}
              </div>
              <div className="printer-card-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={!printer.is_active || testingId !== null}
                  onClick={() => void testPrinter(printer)}
                >
                  {testingId === printer.id ? 'Queuing test…' : 'Print test ticket'}
                </button>
                <button className="secondary-button" type="button" onClick={() => editPrinter(printer)}>Edit</button>
                <button className="danger-text-button" type="button" onClick={() => void deletePrinter(printer)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
