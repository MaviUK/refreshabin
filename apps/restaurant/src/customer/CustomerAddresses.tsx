import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'
import './CustomerAddresses.css'

type CustomerAddress = {
  id: string
  label: string
  address_line_1: string
  address_line_2: string | null
  town_city: string
  postcode: string
  delivery_instructions: string | null
  is_default: boolean
}

const emptyForm = {
  label: 'Home',
  addressLine1: '',
  addressLine2: '',
  townCity: '',
  postcode: '',
  deliveryInstructions: '',
}

function formatPostcode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
  return compact.length <= 3 ? compact : `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

export default function CustomerAddresses() {
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadAddresses() {
    const { data, error: addressError } = await supabase
      .from('customer_addresses')
      .select('id,label,address_line_1,address_line_2,town_city,postcode,delivery_instructions,is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (addressError) setError(addressError.message)
    else setAddresses((data || []) as CustomerAddress[])
    setLoading(false)
  }

  useEffect(() => {
    async function initialise() {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        navigate('/account/login', { replace: true, state: { from: '/account/addresses' } })
        return
      }
      await loadAddresses()
    }
    void initialise()
  }, [navigate])

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function editAddress(address: CustomerAddress) {
    setEditingId(address.id)
    setForm({
      label: address.label,
      addressLine1: address.address_line_1,
      addressLine2: address.address_line_2 || '',
      townCity: address.town_city,
      postcode: address.postcode,
      deliveryInstructions: address.delivery_instructions || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!form.label.trim() || !form.addressLine1.trim() || !form.townCity.trim() || !form.postcode.trim()) {
      setError('Please complete all required address fields.')
      return
    }

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      navigate('/account/login', { replace: true })
      return
    }

    const payload = {
      user_id: userData.user.id,
      label: form.label.trim(),
      address_line_1: form.addressLine1.trim(),
      address_line_2: form.addressLine2.trim() || null,
      town_city: form.townCity.trim(),
      postcode: formatPostcode(form.postcode),
      delivery_instructions: form.deliveryInstructions.trim() || null,
      updated_at: new Date().toISOString(),
      ...(!editingId && addresses.length === 0 ? { is_default: true } : {}),
    }

    const result = editingId
      ? await supabase.from('customer_addresses').update(payload).eq('id', editingId)
      : await supabase.from('customer_addresses').insert(payload)

    if (result.error) setError(result.error.message)
    else {
      resetForm()
      await loadAddresses()
    }
    setSaving(false)
  }

  async function setDefault(addressId: string) {
    setError('')
    const { error: defaultError } = await supabase.rpc('set_customer_address_default', { target_address_id: addressId })
    if (defaultError) setError(defaultError.message)
    else await loadAddresses()
  }

  async function removeAddress(address: CustomerAddress) {
    if (!window.confirm(`Delete ${address.label}?`)) return
    setError('')
    const { error: deleteError } = await supabase.from('customer_addresses').delete().eq('id', address.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAddresses()
    if (editingId === address.id) resetForm()
  }

  return (
    <main className="customer-account-shell customer-account-shell--wide">
      <section className="customer-account-card">
        <header className="customer-account-header">
          <div>
            <Link className="customer-account-brand" to="/">ordered.food</Link>
            <span className="customer-account-eyebrow">Customer account</span>
            <h1>Saved addresses</h1>
          </div>
          <Link className="customer-account-secondary customer-account-link-button" to="/account/orders">My orders</Link>
        </header>

        {error && <div className="customer-account-error" role="alert">{error}</div>}

        <form className="customer-address-form" onSubmit={saveAddress}>
          <div className="customer-address-form-heading">
            <div><span className="customer-account-eyebrow">{editingId ? 'Editing' : 'New address'}</span><h2>{editingId ? 'Update address' : 'Add an address'}</h2></div>
            {editingId && <button type="button" className="customer-address-text-button" onClick={resetForm}>Cancel</button>}
          </div>
          <div className="customer-address-fields customer-address-fields--two">
            <label>Label<input value={form.label} onChange={(event) => updateField('label', event.target.value)} placeholder="Home or Work" maxLength={40} required /></label>
            <label>Postcode<input value={form.postcode} onChange={(event) => updateField('postcode', formatPostcode(event.target.value))} placeholder="BT20 4AA" required /></label>
          </div>
          <div className="customer-address-fields">
            <label>Address line 1<input value={form.addressLine1} onChange={(event) => updateField('addressLine1', event.target.value)} required /></label>
            <label>Address line 2 <span>Optional</span><input value={form.addressLine2} onChange={(event) => updateField('addressLine2', event.target.value)} /></label>
            <label>Town or city<input value={form.townCity} onChange={(event) => updateField('townCity', event.target.value)} required /></label>
            <label>Delivery instructions <span>Optional</span><textarea value={form.deliveryInstructions} onChange={(event) => updateField('deliveryInstructions', event.target.value)} placeholder="Gate code, landmark or where to leave the order" rows={3} /></label>
          </div>
          <button className="customer-address-save" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add address'}</button>
        </form>

        <section className="customer-address-list-section">
          <div className="customer-order-section-heading"><div><span className="customer-account-eyebrow">Your addresses</span><h2>{addresses.length} saved</h2></div></div>
          {loading && <p>Loading addresses…</p>}
          {!loading && addresses.length === 0 && <div className="customer-account-empty"><h2>No saved addresses</h2><p>Add your first address to make delivery checkout faster.</p></div>}
          <div className="customer-address-list">
            {addresses.map((address) => (
              <article className={`customer-address-card${address.is_default ? ' customer-address-card--default' : ''}`} key={address.id}>
                <div className="customer-address-card-topline">
                  <div><h3>{address.label}</h3>{address.is_default && <span>Default</span>}</div>
                  <button type="button" onClick={() => editAddress(address)}>Edit</button>
                </div>
                <p>{address.address_line_1}{address.address_line_2 ? `, ${address.address_line_2}` : ''}<br />{address.town_city}<br />{address.postcode}</p>
                {address.delivery_instructions && <small>{address.delivery_instructions}</small>}
                <div className="customer-address-actions">
                  {!address.is_default && <button type="button" onClick={() => void setDefault(address.id)}>Set as default</button>}
                  <button type="button" className="customer-address-delete" onClick={() => void removeAddress(address)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
