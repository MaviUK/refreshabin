import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Restaurant = {
  id: string
  name: string
  slug: string
  status: string
  cuisines: string[] | null
  email: string | null
  phone: string | null
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number
  delivery_fee_pence: number
  delivery_radius_miles: number | string
  preparation_time_minutes: number
  logo_url: string | null
  cover_url: string | null
  onboarding_step: number | null
  approval_notes: string | null
}

type Location = {
  id: string
  line1: string
  line2: string | null
  city: string
  postcode: string
}

type DayHours = {
  day_of_week: number
  label: string
  is_closed: boolean
  open_time: string
  close_time: string
}

type ScannedItem = {
  name: string
  description: string
  price_pence: number | null
  price: string
  vegetarian: boolean
  vegan: boolean
  confidence: number | null
  warnings: string[]
}

type ScannedCategory = {
  name: string
  items: ScannedItem[]
}

type ScannedModifierOption = { name: string; price_pence: number; price: string }
type ScannedModifierGroup = {
  name: string
  description: string
  selection_type: 'single' | 'multiple'
  minimum_selections: number
  maximum_selections: number | null
  options: ScannedModifierOption[]
  applies_to_item_names: string[]
}

type ExtractedMenu = {
  restaurant_name: string | undefined
  categories: ScannedCategory[]
  warnings: string[]
  modifier_groups: ScannedModifierGroup[]
}

type MenuImport = {
  id: string
  file_name: string
  file_path: string
  mime_type: string
  file_size_bytes: number
  status: 'queued' | 'processing' | 'review' | 'imported' | 'failed' | string
  extracted_menu: unknown
  confidence_notes: unknown
  error_message: string | null
  created_at: string
}

type MenuSectionMeta = {
  section_name: string
  scan_instructions: string
  section_confirmed: boolean
  menu_complete: boolean
  menu_reupload: boolean
}

type Counts = {
  categories: number
  items: number
}

const STEP = {
  welcome: 0,
  details: 1,
  address: 2,
  contact: 3,
  fulfilment: 4,
  hours: 5,
  upload: 6,
  scanning: 7,
  menuReview: 8,
  branding: 9,
  payments: 10,
  applicationReview: 11,
  submit: 12,
} as const

const stepLabels = [
  'Welcome',
  'Restaurant details',
  'Trading address',
  'Contact details',
  'Delivery and collection',
  'Opening hours',
  'Upload menu',
  'AI menu scan',
  'Review menu',
  'Branding and images',
  'Payment setup',
  'Review application',
  'Submit for approval',
]

const cuisineOptions = [
  'Pizza', 'Burgers', 'Chinese', 'Indian', 'Fish & Chips', 'Kebab',
  'Cafe', 'Desserts', 'Thai', 'Italian', 'Mexican', 'Healthy',
]

const defaultHours: DayHours[] = [
  { day_of_week: 1, label: 'Monday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 2, label: 'Tuesday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 3, label: 'Wednesday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 4, label: 'Thursday', is_closed: false, open_time: '09:00', close_time: '22:00' },
  { day_of_week: 5, label: 'Friday', is_closed: false, open_time: '09:00', close_time: '23:00' },
  { day_of_week: 6, label: 'Saturday', is_closed: false, open_time: '09:00', close_time: '23:00' },
  { day_of_week: 0, label: 'Sunday', is_closed: false, open_time: '10:00', close_time: '21:00' },
]

const acceptedMenuTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const maxMenuBytes = 15 * 1024 * 1024
const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function normaliseExtractedMenu(value: unknown, notes: unknown): ExtractedMenu {
  const root = asRecord(value)
  const rawCategories = Array.isArray(root.categories) ? root.categories : []
  const noteWarnings = typeof notes === 'string'
    ? [notes]
    : Array.isArray(notes)
      ? notes.map((entry) => {
          if (typeof entry === 'string') return entry
          const note = asRecord(entry)
          return [note.category, note.item, note.note].filter((part): part is string => typeof part === 'string').join(' · ')
        }).filter(Boolean)
      : asStringArray(asRecord(notes).warnings)

  return {
    restaurant_name: typeof root.restaurant_name === 'string' ? root.restaurant_name : undefined,
    warnings: [...asStringArray(root.warnings), ...noteWarnings],
    modifier_groups: (Array.isArray(root.modifier_groups) ? root.modifier_groups : []).map((groupValue) => {
      const group = asRecord(groupValue)
      return {
        name: typeof group.name === 'string' ? group.name : 'Choose an option',
        description: typeof group.description === 'string' ? group.description : '',
        selection_type: group.selection_type === 'multiple' ? 'multiple' : 'single',
        minimum_selections: typeof group.minimum_selections === 'number' ? group.minimum_selections : 0,
        maximum_selections: typeof group.maximum_selections === 'number' ? group.maximum_selections : null,
        applies_to_item_names: asStringArray(group.applies_to_item_names),
        options: (Array.isArray(group.options) ? group.options : []).map((optionValue) => {
          const option = asRecord(optionValue)
          const price = typeof option.price_pence === 'number' ? Math.max(0, Math.round(option.price_pence)) : 0
          return { name: typeof option.name === 'string' ? option.name : '', price_pence: price, price: (price / 100).toFixed(2) }
        }),
      }
    }),
    categories: rawCategories.map((categoryValue) => {
      const category = asRecord(categoryValue)
      const rawItems = Array.isArray(category.items) ? category.items : []
      return {
        name: typeof category.name === 'string' ? category.name : 'Untitled category',
        items: rawItems.map((itemValue) => {
          const item = asRecord(itemValue)
          const rawPrice = item.price_pence ?? item.price
          const parsedPrice = rawPrice === null || rawPrice === undefined
            ? Number.NaN
            : typeof rawPrice === 'number' ? rawPrice : Number(rawPrice)
          return {
            name: typeof item.name === 'string' ? item.name : '',
            description: typeof item.description === 'string' ? item.description : '',
            price_pence: Number.isFinite(parsedPrice) ? Math.round(parsedPrice) : null,
            price: Number.isFinite(parsedPrice) ? (Math.round(parsedPrice) / 100).toFixed(2) : '',
            vegetarian: Boolean(item.vegetarian ?? item.is_vegetarian),
            vegan: Boolean(item.vegan ?? item.is_vegan),
            confidence: typeof item.confidence === 'number' ? item.confidence : null,
            warnings: [
              ...asStringArray(item.warnings),
              ...(typeof item.notes === 'string' && item.notes ? [item.notes] : []),
            ],
          }
        }),
      }
    }),
  }
}

function serialiseExtractedMenu(menu: ExtractedMenu) {
  return {
    restaurant_name: menu.restaurant_name ?? null,
    currency: 'GBP',
    warnings: menu.warnings,
    modifier_groups: menu.modifier_groups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ name: option.name, price_pence: pence(option.price) })),
    })),
    categories: menu.categories.map((category) => ({
      name: category.name,
      description: null,
      items: category.items.map((item) => ({
        name: item.name,
        description: item.description || null,
        price_pence: item.price.trim() ? pence(item.price) : null,
        is_vegetarian: item.vegetarian,
        is_vegan: item.vegan,
        confidence: item.confidence ?? 1,
        notes: item.warnings.join(' · ') || null,
      })),
    })),
  }
}

function menuSectionMeta(value: unknown): MenuSectionMeta {
  const record = asRecord(value)
  return {
    section_name: typeof record.section_name === 'string' ? record.section_name : '',
    scan_instructions: typeof record.scan_instructions === 'string' ? record.scan_instructions : '',
    section_confirmed: Boolean(record.section_confirmed),
    menu_complete: Boolean(record.menu_complete),
    menu_reupload: Boolean(record.menu_reupload),
  }
}

function pounds(value: number | null | undefined) {
  return ((value ?? 0) / 100).toFixed(2)
}

function pence(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

function browserCompatibleUuid() {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

function slugPreview(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'your-restaurant'
}

async function optimiseImage(file: File, type: 'logo' | 'cover') {
  const size = type === 'logo' ? { width: 720, height: 720 } : { width: 1800, height: 900 }
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not process this image.')

  const sourceRatio = bitmap.width / bitmap.height
  const targetRatio = size.width / size.height
  let sourceWidth = bitmap.width
  let sourceHeight = bitmap.height
  let sourceX = 0
  let sourceY = 0
  if (sourceRatio > targetRatio) {
    sourceWidth = bitmap.height * targetRatio
    sourceX = (bitmap.width - sourceWidth) / 2
  } else {
    sourceHeight = bitmap.width / targetRatio
    sourceY = (bitmap.height - sourceHeight) / 2
  }
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size.width, size.height)
  bitmap.close()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The image could not be converted.')),
      'image/webp',
      0.88,
    )
  })
}

function StepActions({
  onBack,
  onContinue,
  saving,
  continueLabel = 'Save and continue',
  disabled = false,
}: {
  onBack?: () => void
  onContinue: () => void
  saving: boolean
  continueLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="onboarding-actions">
      {onBack
        ? <button className="text-button" type="button" onClick={onBack} disabled={saving}>Back</button>
        : <span />}
      <button className="primary-button" type="button" onClick={onContinue} disabled={saving || disabled}>
        {saving ? 'Saving…' : continueLabel}
      </button>
    </div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const menuReupload = searchParams.get('menu-reupload') === '1'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scanPollRef = useRef<number | null>(null)
  const [step, setStep] = useState<number>(STEP.welcome)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [hours, setHours] = useState<DayHours[]>(defaultHours)
  const [menuImport, setMenuImport] = useState<MenuImport | null>(null)
  const [extractedMenu, setExtractedMenu] = useState<ExtractedMenu>({ restaurant_name: undefined, categories: [], warnings: [], modifier_groups: [] })
  const [counts, setCounts] = useState<Counts>({ categories: 0, items: 0 })
  const [userId, setUserId] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [missingRequirements, setMissingRequirements] = useState<string[]>([])
  const [sectionName, setSectionName] = useState('')
  const [sectionInstructions, setSectionInstructions] = useState('')

  const [name, setName] = useState('')
  const [cuisines, setCuisines] = useState<string[]>([])
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [acceptsDelivery, setAcceptsDelivery] = useState(true)
  const [acceptsCollection, setAcceptsCollection] = useState(true)
  const [minimumOrder, setMinimumOrder] = useState('0.00')
  const [deliveryFee, setDeliveryFee] = useState('0.00')
  const [deliveryRadius, setDeliveryRadius] = useState('3')
  const [preparationTime, setPreparationTime] = useState('25')

  const progress = useMemo(
    () => Math.round(((Math.min(step, STEP.submit) + 1) / stepLabels.length) * 100),
    [step],
  )

  const loadApplication = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        navigate('/login', { replace: true, state: { from: '/onboarding' } })
        return
      }
      setUserId(userData.user.id)
      setUserEmail(userData.user.email || '')

      const { data: membership, error: membershipError } = await supabase
        .from('restaurant_members')
        .select('restaurant_id')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (membershipError) throw membershipError
      if (!membership) {
        const localDraft = localStorage.getItem(`ordered.food:restaurant-application:${userData.user.id}`)
        if (localDraft) {
          try {
            const parsed = JSON.parse(localDraft) as { name?: string; cuisines?: string[] }
            setName(parsed.name || '')
            setCuisines(Array.isArray(parsed.cuisines) ? parsed.cuisines : [])
            setStep(STEP.address)
          } catch {
            localStorage.removeItem(`ordered.food:restaurant-application:${userData.user.id}`)
          }
        }
        setRestaurant(null)
        setEmail(userData.user.email || '')
        if (!localDraft) setStep(STEP.welcome)
        return
      }

      const restaurantId = membership.restaurant_id as string
      const [restaurantResult, locationResult, importResult, categoryResult, itemResult] = await Promise.all([
        supabase
          .from('restaurants')
          .select('id,name,slug,status,cuisines,email,phone,accepts_delivery,accepts_collection,minimum_order_pence,delivery_fee_pence,delivery_radius_miles,preparation_time_minutes,logo_url,cover_url,onboarding_step,approval_notes')
          .eq('id', restaurantId)
          .single(),
        supabase
          .from('restaurant_locations')
          .select('id,line1,line2,city,postcode')
          .eq('restaurant_id', restaurantId)
          .eq('is_primary', true)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('menu_imports')
          .select('id,file_name,file_path,mime_type,file_size_bytes,status,extracted_menu,confidence_notes,error_message,created_at')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      ])
      const firstError = [
        restaurantResult.error, locationResult.error, importResult.error,
        categoryResult.error, itemResult.error,
      ].find(Boolean)
      if (firstError) throw firstError

      const nextRestaurant = restaurantResult.data as Restaurant
      if (nextRestaurant.status === 'active' && !menuReupload) {
        navigate('/dashboard', { replace: true })
        return
      }
      setRestaurant(nextRestaurant)
      setName(nextRestaurant.name || '')
      setCuisines(nextRestaurant.cuisines || [])
      setEmail(nextRestaurant.email || userData.user.email || '')
      setPhone(nextRestaurant.phone || '')
      setAcceptsDelivery(nextRestaurant.accepts_delivery)
      setAcceptsCollection(nextRestaurant.accepts_collection)
      setMinimumOrder(pounds(nextRestaurant.minimum_order_pence))
      setDeliveryFee(pounds(nextRestaurant.delivery_fee_pence))
      setDeliveryRadius(String(nextRestaurant.delivery_radius_miles ?? 3))
      setPreparationTime(String(nextRestaurant.preparation_time_minutes ?? 25))

      const nextLocation = locationResult.data as Location | null
      setLocation(nextLocation)
      setLine1(nextLocation?.line1 || '')
      setLine2(nextLocation?.line2 || '')
      setCity(nextLocation?.city || '')
      setPostcode(nextLocation?.postcode || '')

      if (nextLocation) {
        const { data: storedHours, error: hoursError } = await supabase
          .from('opening_hours')
          .select('day_of_week,open_time,close_time,is_closed')
          .eq('location_id', nextLocation.id)
        if (hoursError) throw hoursError
        if (storedHours?.length) {
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
      }

      const fetchedImport = importResult.data as MenuImport | null
      const fetchedSection = menuSectionMeta(fetchedImport?.confidence_notes)
      const latestImport = menuReupload && !fetchedSection.menu_reupload ? null : fetchedImport
      setMenuImport(latestImport)
      const latestSection = menuSectionMeta(latestImport?.confidence_notes)
      if (latestImport) {
        setExtractedMenu(normaliseExtractedMenu(latestImport.extracted_menu, latestImport.confidence_notes))
        setSectionName(latestSection.section_name)
        setSectionInstructions(latestSection.scan_instructions)
      }
      setCounts({ categories: categoryResult.count ?? 0, items: itemResult.count ?? 0 })

      if (menuReupload) {
        if (latestImport?.status === 'processing' || latestImport?.status === 'queued') setStep(STEP.scanning)
        else if (latestImport?.status === 'review') setStep(STEP.menuReview)
        else setStep(STEP.upload)
      } else if (nextRestaurant.status === 'pending_approval') {
        setStep(STEP.submit)
      } else {
        const savedStep = Math.max(STEP.welcome, Math.min(nextRestaurant.onboarding_step ?? STEP.welcome, STEP.applicationReview))
        if (latestImport?.status === 'imported' && latestSection.section_confirmed && !latestSection.menu_complete) setStep(STEP.upload)
        else if (latestImport?.status === 'processing' || latestImport?.status === 'queued') setStep(STEP.scanning)
        else if (latestImport?.status === 'review' && savedStep <= STEP.menuReview) setStep(STEP.menuReview)
        else setStep(savedStep)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load your application.')
    } finally {
      setLoading(false)
    }
  }, [navigate, menuReupload])

  useEffect(() => {
    void loadApplication()
    return () => {
      if (scanPollRef.current) window.clearInterval(scanPollRef.current)
    }
  }, [loadApplication])

  useEffect(() => {
    if (step !== STEP.scanning || !menuImport || !['queued', 'processing'].includes(menuImport.status)) return
    if (scanPollRef.current) window.clearInterval(scanPollRef.current)
    scanPollRef.current = window.setInterval(() => void refreshImport(menuImport.id), 2500)
    return () => {
      if (scanPollRef.current) window.clearInterval(scanPollRef.current)
      scanPollRef.current = null
    }
  }, [step, menuImport?.id, menuImport?.status])

  function clearMessages() {
    setError('')
    setSuccess('')
    setMissingRequirements([])
  }

  async function advance(nextStep: number) {
    if (!restaurant) {
      setStep(nextStep)
      return
    }
    const { error: progressError } = await supabase.rpc('set_restaurant_onboarding_step', {
      p_restaurant_id: restaurant.id,
      p_step: nextStep,
    })
    if (progressError) throw progressError
    setRestaurant((current) => current ? {
      ...current,
      onboarding_step: Math.max(current.onboarding_step ?? 0, nextStep),
    } : current)
    setStep(nextStep)
  }

  function back() {
    clearMessages()
    setStep((current) => Math.max(STEP.welcome, current - 1))
  }

  async function saveDetails() {
    clearMessages()
    if (!name.trim()) return setError('Enter the restaurant name.')
    if (!cuisines.length) return setError('Choose at least one cuisine.')
    setSaving(true)
    try {
      if (!restaurant) {
        localStorage.setItem(`ordered.food:restaurant-application:${userId}`, JSON.stringify({
          name: name.trim(),
          cuisines,
        }))
        setStep(STEP.address)
      } else {
        const { error: updateError } = await supabase
          .from('restaurants')
          .update({
            name: name.trim(),
            cuisines,
            status: 'draft',
            updated_at: new Date().toISOString(),
          })
          .eq('id', restaurant.id)
        if (updateError) throw updateError
        await advance(STEP.address)
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save restaurant details.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAddress() {
    clearMessages()
    if (!line1.trim() || !city.trim() || !postcode.trim()) return setError('Enter the full trading address.')
    setSaving(true)
    try {
      if (!restaurant) {
        const { data: createdId, error: createError } = await supabase.rpc('create_restaurant_onboarding', {
          restaurant_name: name.trim(),
          restaurant_cuisines: cuisines,
          contact_email: userEmail,
          contact_phone: '',
          address_line1: line1.trim(),
          address_line2: line2.trim(),
          address_city: city.trim(),
          address_postcode: postcode.trim().toUpperCase(),
        })
        if (createError) throw createError
        const id = createdId as string
        const [restaurantResult, locationResult] = await Promise.all([
          supabase
            .from('restaurants')
            .select('id,name,slug,status,cuisines,email,phone,accepts_delivery,accepts_collection,minimum_order_pence,delivery_fee_pence,delivery_radius_miles,preparation_time_minutes,logo_url,cover_url,onboarding_step,approval_notes')
            .eq('id', id)
            .single(),
          supabase
            .from('restaurant_locations')
            .select('id,line1,line2,city,postcode')
            .eq('restaurant_id', id)
            .eq('is_primary', true)
            .single(),
        ])
        if (restaurantResult.error) throw restaurantResult.error
        if (locationResult.error) throw locationResult.error
        const { error: progressError } = await supabase.rpc('set_restaurant_onboarding_step', {
          p_restaurant_id: id,
          p_step: STEP.contact,
        })
        if (progressError) throw progressError
        setRestaurant({ ...(restaurantResult.data as Restaurant), onboarding_step: STEP.contact })
        setLocation(locationResult.data as Location)
        localStorage.removeItem(`ordered.food:restaurant-application:${userId}`)
        setStep(STEP.contact)
        return
      }
      const row = {
        restaurant_id: restaurant.id,
        name: 'Main location',
        line1: line1.trim(),
        line2: line2.trim() || null,
        city: city.trim(),
        postcode: postcode.trim().toUpperCase(),
        timezone: 'Europe/London',
        is_primary: true,
        is_active: true,
        updated_at: new Date().toISOString(),
      }
      const query = location
        ? supabase.from('restaurant_locations').update(row).eq('id', location.id)
        : supabase.from('restaurant_locations').insert(row)
      const { data, error: saveError } = await query
        .select('id,line1,line2,city,postcode')
        .single()
      if (saveError) throw saveError
      setLocation(data as Location)
      await advance(STEP.contact)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the trading address.')
    } finally {
      setSaving(false)
    }
  }

  async function saveContact() {
    clearMessages()
    if (!restaurant) return
    if (!email.trim() || !phone.trim()) return setError('Enter both an email address and phone number.')
    setSaving(true)
    try {
      const { error: saveError } = await supabase
        .from('restaurants')
        .update({ email: email.trim(), phone: phone.trim(), updated_at: new Date().toISOString() })
        .eq('id', restaurant.id)
      if (saveError) throw saveError
      setRestaurant({ ...restaurant, email: email.trim(), phone: phone.trim() })
      await advance(STEP.fulfilment)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save contact details.')
    } finally {
      setSaving(false)
    }
  }

  async function saveFulfilment() {
    clearMessages()
    if (!restaurant) return
    if (!acceptsDelivery && !acceptsCollection) return setError('Enable delivery, collection, or both.')
    const radius = Number.parseFloat(deliveryRadius)
    const prep = Number.parseInt(preparationTime, 10)
    if (acceptsDelivery && (!Number.isFinite(radius) || radius <= 0)) return setError('Enter a valid delivery radius.')
    if (!Number.isInteger(prep) || prep < 5 || prep > 240) return setError('Preparation time must be between 5 and 240 minutes.')
    setSaving(true)
    try {
      const patch = {
        accepts_delivery: acceptsDelivery,
        accepts_collection: acceptsCollection,
        minimum_order_pence: pence(minimumOrder),
        delivery_fee_pence: acceptsDelivery ? pence(deliveryFee) : 0,
        delivery_radius_miles: acceptsDelivery ? radius : 0,
        preparation_time_minutes: prep,
        updated_at: new Date().toISOString(),
      }
      const { error: saveError } = await supabase.from('restaurants').update(patch).eq('id', restaurant.id)
      if (saveError) throw saveError
      setRestaurant({ ...restaurant, ...patch })
      await advance(STEP.hours)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save delivery and collection settings.')
    } finally {
      setSaving(false)
    }
  }

  function updateDay(dayOfWeek: number, patch: Partial<DayHours>) {
    setHours((current) => current.map((day) => day.day_of_week === dayOfWeek ? { ...day, ...patch } : day))
  }

  async function saveHours() {
    clearMessages()
    if (!location) return setError('Save the trading address before opening hours.')
    const invalid = hours.find((day) => !day.is_closed && (!day.open_time || !day.close_time || day.open_time === day.close_time))
    if (invalid) return setError(`${invalid.label} needs different opening and closing times.`)
    setSaving(true)
    try {
      const { error: saveError } = await supabase.from('opening_hours').upsert(hours.map((day) => ({
        location_id: location.id,
        day_of_week: day.day_of_week,
        is_closed: day.is_closed,
        open_time: day.is_closed ? null : day.open_time,
        close_time: day.is_closed ? null : day.close_time,
        updated_at: new Date().toISOString(),
      })), { onConflict: 'location_id,day_of_week' })
      if (saveError) throw saveError
      await advance(STEP.upload)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save opening hours.')
    } finally {
      setSaving(false)
    }
  }

  async function handleMenuFile(file: File) {
    clearMessages()
    if (!restaurant) return
    if (!sectionName.trim()) return setError('Name this menu section before uploading its file.')
    if (!acceptedMenuTypes.includes(file.type)) return setError('Choose a PDF, JPG, PNG or WebP menu file.')
    if (file.size > maxMenuBytes) return setError('Choose a menu file smaller than 15 MB.')
    setSaving(true)
    setUploadProgress(10)
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('Your session has expired.')
      const path = `${restaurant.id}/${browserCompatibleUuid()}-${safeFileName(file.name) || 'menu'}`
      const { data: createdImport, error: importError } = await supabase
        .from('menu_imports')
        .insert({
          restaurant_id: restaurant.id,
          uploaded_by: userData.user.id,
          file_name: file.name,
          file_path: path,
          mime_type: file.type,
          file_size_bytes: file.size,
          status: 'queued',
          confidence_notes: {
            section_name: sectionName.trim(),
            scan_instructions: sectionInstructions.trim(),
            section_confirmed: false,
            menu_complete: false,
            menu_reupload: menuReupload,
            warnings: [],
          },
        })
        .select('id,file_name,file_path,mime_type,file_size_bytes,status,extracted_menu,confidence_notes,error_message,created_at')
        .single()
      if (importError) throw importError
      setUploadProgress(35)
      const { error: uploadError } = await supabase.storage
        .from('restaurant-menu-uploads')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) {
        await supabase.from('menu_imports').update({ status: 'failed', error_message: uploadError.message }).eq('id', createdImport.id)
        throw uploadError
      }
      setUploadProgress(75)
      setMenuImport({ ...createdImport, status: 'processing' } as MenuImport)
      setUploadProgress(80)
      await advance(STEP.scanning)
      const { error: invokeError } = await supabase.functions.invoke('scan-menu-import', {
        body: {
          import_id: createdImport.id,
          section_name: sectionName.trim(),
          scan_instructions: sectionInstructions.trim(),
        },
      })
      if (invokeError) throw invokeError
      setUploadProgress(100)
      await refreshImport(createdImport.id)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload and scan the menu.')
    } finally {
      setSaving(false)
    }
  }

  async function refreshImport(importId: string) {
    const { data, error: refreshError } = await supabase
      .from('menu_imports')
      .select('id,file_name,file_path,mime_type,file_size_bytes,status,extracted_menu,confidence_notes,error_message,created_at')
      .eq('id', importId)
      .single()
    if (refreshError) {
      setError(refreshError.message)
      return
    }
    const nextImport = data as MenuImport
    setMenuImport(nextImport)
    if (nextImport.status === 'review') {
      const section = menuSectionMeta(nextImport.confidence_notes)
      const scanned = normaliseExtractedMenu(nextImport.extracted_menu, nextImport.confidence_notes)
      setSectionName(section.section_name)
      setSectionInstructions(section.scan_instructions)
      setExtractedMenu({
        ...scanned,
        categories: [{
          name: section.section_name || scanned.categories[0]?.name || 'Menu section',
          items: scanned.categories.flatMap((category) => category.items),
        }],
      })
      setStep(STEP.menuReview)
    }
    if (nextImport.status === 'failed') setStep(STEP.upload)
  }

  async function retryScan() {
    if (!menuImport) return
    clearMessages()
    setSaving(true)
    try {
      const { error: updateError } = await supabase
        .from('menu_imports')
        .update({ status: 'queued', error_message: null })
        .eq('id', menuImport.id)
      if (updateError) throw updateError
      const section = menuSectionMeta(menuImport.confidence_notes)
      const { error: invokeError } = await supabase.functions.invoke('scan-menu-import', { body: {
        import_id: menuImport.id,
        section_name: section.section_name || sectionName.trim(),
        scan_instructions: section.scan_instructions || sectionInstructions.trim(),
      } })
      if (invokeError) throw invokeError
      setMenuImport({ ...menuImport, status: 'processing', error_message: null })
      setStep(STEP.scanning)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to retry the scan.')
    } finally {
      setSaving(false)
    }
  }

  function updateCategory(categoryIndex: number, patch: Partial<ScannedCategory>) {
    setExtractedMenu((current) => ({
      ...current,
      categories: current.categories.map((category, index) => index === categoryIndex ? { ...category, ...patch } : category),
    }))
  }

  function updateItem(categoryIndex: number, itemIndex: number, patch: Partial<ScannedItem>) {
    setExtractedMenu((current) => ({
      ...current,
      categories: current.categories.map((category, index) => index === categoryIndex ? {
        ...category,
        items: category.items.map((item, position) => position === itemIndex ? { ...item, ...patch } : item),
      } : category),
      modifier_groups: typeof patch.name === 'string'
        ? current.modifier_groups.map((group) => ({
            ...group,
            applies_to_item_names: group.applies_to_item_names.map((name) => (
              name.trim().toLocaleLowerCase() === current.categories[categoryIndex]?.items[itemIndex]?.name.trim().toLocaleLowerCase()
                ? patch.name!.trim()
                : name
            )).filter(Boolean),
          }))
        : current.modifier_groups,
    }))
  }

  function removeItem(categoryIndex: number, itemIndex: number) {
    setExtractedMenu((current) => {
      const removedName = current.categories[categoryIndex]?.items[itemIndex]?.name.trim().toLocaleLowerCase()
      return {
        ...current,
        categories: current.categories.map((category, index) => index === categoryIndex ? {
          ...category,
          items: category.items.filter((_, position) => position !== itemIndex),
        } : category),
        modifier_groups: current.modifier_groups.map((group) => ({
          ...group,
          applies_to_item_names: group.applies_to_item_names.filter((name) => name.trim().toLocaleLowerCase() !== removedName),
        })),
      }
    })
  }

  function updateModifierGroup(groupIndex: number, patch: Partial<ScannedModifierGroup>) {
    setExtractedMenu((current) => ({ ...current, modifier_groups: current.modifier_groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group) }))
  }

  function toggleModifierDish(groupIndex: number, itemName: string) {
    setExtractedMenu((current) => {
      const dishNames = current.categories.flatMap((category) => category.items.map((item) => item.name.trim())).filter(Boolean)
      return {
        ...current,
        modifier_groups: current.modifier_groups.map((group, index) => {
          if (index !== groupIndex) return group
          const selectedNames = group.applies_to_item_names.length ? group.applies_to_item_names : dishNames
          const selected = selectedNames.some((name) => name.trim().toLocaleLowerCase() === itemName.trim().toLocaleLowerCase())
          if (selected && selectedNames.length === 1) return group
          const nextNames = selected
            ? selectedNames.filter((name) => name.trim().toLocaleLowerCase() !== itemName.trim().toLocaleLowerCase())
            : [...selectedNames, itemName]
          const appliesToAll = dishNames.length > 0 && dishNames.every((name) => nextNames.some((selectedName) => selectedName.trim().toLocaleLowerCase() === name.toLocaleLowerCase()))
          return {
            ...group,
            applies_to_item_names: appliesToAll ? [] : nextNames,
          }
        }),
      }
    })
  }

  async function applyImportedModifierGroups(categoryName: string, groups: ScannedModifierGroup[]) {
    if (!restaurant || !groups.length) return
    const { data: category, error: categoryError } = await supabase.from('menu_categories').select('id').eq('restaurant_id', restaurant.id).eq('name', categoryName).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (categoryError) throw categoryError
    if (!category) throw new Error('The imported category could not be found for its choices.')
    const { data: importedItems, error: itemError } = await supabase.from('menu_items').select('id,name').eq('restaurant_id', restaurant.id).eq('category_id', category.id)
    if (itemError) throw itemError
    for (const [groupIndex, group] of groups.entries()) {
      const validOptions = group.options.filter((option) => option.name.trim())
      if (!group.name.trim() || !validOptions.length) continue
      const { data: createdGroup, error: groupError } = await supabase.from('modifier_groups').insert({ restaurant_id: restaurant.id, name: group.name.trim(), description: group.description.trim() || null, selection_type: group.selection_type, minimum_selections: Math.max(0, group.minimum_selections), maximum_selections: group.maximum_selections, free_selections: 0, is_active: true, sort_order: groupIndex }).select('id').single()
      if (groupError) throw groupError
      const { error: optionsError } = await supabase.from('modifier_options').insert(validOptions.map((option, optionIndex) => ({ restaurant_id: restaurant.id, modifier_group_id: createdGroup.id, name: option.name.trim(), price_pence: pence(option.price), maximum_quantity: 1, is_default: false, is_available: true, sort_order: optionIndex })))
      if (optionsError) throw optionsError
      const requestedNames = new Set(group.applies_to_item_names.map((name) => name.trim().toLocaleLowerCase()))
      const targets = (importedItems || []).filter((item) => !requestedNames.size || requestedNames.has(item.name.trim().toLocaleLowerCase()))
      if (targets.length) {
        const { error: assignmentsError } = await supabase.from('menu_item_modifier_groups').insert(targets.map((item, itemIndex) => ({ restaurant_id: restaurant.id, menu_item_id: item.id, modifier_group_id: createdGroup.id, sort_order: itemIndex })))
        if (assignmentsError) throw assignmentsError
      }
    }
  }

  async function importScannedMenu() {
    clearMessages()
    if (!menuImport) return
    const validItems = extractedMenu.categories.flatMap((category) => category.items).filter((item) => item.name.trim())
    if (!extractedMenu.categories.length || !validItems.length) return setError('Keep at least one category and one menu item.')
    setSaving(true)
    try {
      const { error: saveError } = await supabase
        .from('menu_imports')
        .update({
          extracted_menu: serialiseExtractedMenu(extractedMenu),
          confidence_notes: {
            section_name: extractedMenu.categories[0]?.name.trim() || sectionName.trim(),
            scan_instructions: sectionInstructions.trim(),
            section_confirmed: false,
            menu_complete: false,
            menu_reupload: menuReupload,
            warnings: extractedMenu.warnings,
          },
        })
        .eq('id', menuImport.id)
      if (saveError) throw saveError
      const { data, error: applyError } = await supabase.rpc('apply_scanned_menu_import', {
        p_import_id: menuImport.id,
      })
      if (applyError) throw applyError
      const result = asRecord(data)
      const createdCategories = Number(result.created_categories ?? result.categories_created ?? 0)
      const createdItems = Number(result.created_items ?? result.items_created ?? 0)
      setCounts((current) => ({
        categories: current.categories + createdCategories,
        items: current.items + createdItems,
      }))
      await applyImportedModifierGroups(extractedMenu.categories[0]?.name.trim() || sectionName.trim(), extractedMenu.modifier_groups)
      const confirmedNotes = {
        section_name: extractedMenu.categories[0]?.name.trim() || sectionName.trim(),
        scan_instructions: sectionInstructions.trim(),
        section_confirmed: true,
        menu_complete: false,
        menu_reupload: menuReupload,
        warnings: extractedMenu.warnings,
      }
      const { error: confirmError } = await supabase.from('menu_imports').update({ confidence_notes: confirmedNotes }).eq('id', menuImport.id)
      if (confirmError) throw confirmError
      setMenuImport({ ...menuImport, status: 'imported', extracted_menu: extractedMenu, confidence_notes: confirmedNotes })
      setSectionName('')
      setSectionInstructions('')
      setExtractedMenu({ restaurant_name: undefined, categories: [], warnings: [], modifier_groups: [] })
      setSuccess('Section confirmed. Add the next section, or finish your menu.')
      setStep(STEP.upload)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to import the reviewed menu.')
    } finally {
      setSaving(false)
    }
  }

  async function completeMenu() {
    clearMessages()
    if (!counts.items) return setError('Import at least one menu section before finishing.')
    setSaving(true)
    try {
      if (menuImport?.status === 'imported') {
        const notes = menuSectionMeta(menuImport.confidence_notes)
        const { error: updateError } = await supabase.from('menu_imports').update({
          confidence_notes: { ...notes, menu_complete: true },
        }).eq('id', menuImport.id)
        if (updateError) throw updateError
      }
      if (menuReupload) navigate('/menu', { replace: true })
      else await advance(STEP.branding)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to finish the menu import.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadBrandAsset(type: 'logo' | 'cover', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!restaurant || !file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setError('Choose a JPG, PNG or WebP image.')
    if (file.size > 12 * 1024 * 1024) return setError('Choose an image smaller than 12 MB.')
    clearMessages()
    setSaving(true)
    try {
      const blob = await optimiseImage(file, type)
      const path = `${restaurant.id}/${type}.webp`
      const { error: uploadError } = await supabase.storage
        .from('restaurant-assets')
        .upload(path, blob, { contentType: 'image/webp', upsert: true })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      const url = `${publicData.publicUrl}?v=${Date.now()}`
      const field = type === 'logo' ? 'logo_url' : 'cover_url'
      const { error: updateError } = await supabase.from('restaurants').update({ [field]: url }).eq('id', restaurant.id)
      if (updateError) throw updateError
      setRestaurant({ ...restaurant, [field]: url })
      setSuccess(`${type === 'logo' ? 'Logo' : 'Cover image'} uploaded.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload the image.')
    } finally {
      setSaving(false)
    }
  }

  async function finishBranding() {
    clearMessages()
    setSaving(true)
    try {
      await advance(STEP.payments)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to continue.')
    } finally {
      setSaving(false)
    }
  }

  async function finishPayments() {
    clearMessages()
    setSaving(true)
    try {
      await advance(STEP.applicationReview)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to continue.')
    } finally {
      setSaving(false)
    }
  }

  async function submitApplication() {
    clearMessages()
    if (!restaurant) return
    setSaving(true)
    try {
      const { data, error: submitError } = await supabase.rpc('submit_restaurant_application', {
        p_restaurant_id: restaurant.id,
      })
      if (submitError) throw submitError
      const result = asRecord(data)
      if (!result.submitted) {
        const missing = asStringArray(result.missing)
        setMissingRequirements(missing)
        setError('Complete the missing requirements before submitting.')
        return
      }
      setRestaurant({ ...restaurant, status: 'pending_approval', onboarding_step: STEP.submit })
      setStep(STEP.submit)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to submit the application.')
    } finally {
      setSaving(false)
    }
  }

  function requirementStep(requirement: string) {
    const value = requirement.toLowerCase()
    if (value.includes('address')) return STEP.address
    if (value.includes('email') || value.includes('phone') || value.includes('contact')) return STEP.contact
    if (value.includes('delivery') || value.includes('collection')) return STEP.fulfilment
    if (value.includes('hour')) return STEP.hours
    if (value.includes('menu') || value.includes('categor') || value.includes('item')) return STEP.upload
    return STEP.details
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void handleMenuFile(file)
  }

  if (loading) {
    return <main className="onboarding-shell"><div className="onboarding-loading">Loading your restaurant application…</div></main>
  }

  const pending = restaurant?.status === 'pending_approval'

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Link className="brand" to="/onboarding">ordered.food</Link>
        <span>{pending ? 'Application status' : `Step ${step + 1} of ${stepLabels.length} · ${stepLabels[step]}`}</span>
      </header>

      {!pending && (
        <div className="onboarding-progress" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      <section className={`onboarding-card ${step >= STEP.hours ? 'onboarding-card-wide' : ''}`}>
        {pending && (
          <div className="onboarding-step onboarding-welcome pending-application">
            <span className="onboarding-icon" aria-hidden="true">✓</span>
            <span className="eyebrow">Application submitted</span>
            <h1>Application submitted — Pending approval.</h1>
            <p>Our team will review the restaurant details and menu. We will notify you when the application has been approved or if anything else is needed.</p>
            {restaurant.approval_notes && (
              <div className="application-note"><strong>Review note</strong><p>{restaurant.approval_notes}</p></div>
            )}
            <div className="success-reference">Submitted successfully · Your application is read-only while under review</div>
          </div>
        )}

        {!pending && step === STEP.welcome && (
          <div className="onboarding-step onboarding-welcome">
            <span className="onboarding-icon" aria-hidden="true">👋</span>
            <span className="eyebrow">Restaurant application</span>
            <h1>Let's bring your restaurant to ordered.food.</h1>
            <p>You will add your trading details, menu, opening hours and branding. Every step is saved, so you can leave and return at any time.</p>
            <StepActions onContinue={() => setStep(STEP.details)} saving={false} continueLabel="Start application" />
          </div>
        )}

        {!pending && step === STEP.details && (
          <div className="onboarding-step">
            <span className="eyebrow">Restaurant details</span>
            <h1>Tell us about the restaurant.</h1>
            <p>Use the customer-facing trading name and choose every cuisine that applies.</p>
            <div className="form-grid">
              <label className="large-field full-width">Restaurant name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="The Pizza House" /></label>
              <label className="large-field full-width">Storefront address<input readOnly value={`ordered.food/r/${restaurant?.slug || slugPreview(name)}`} /><span className="field-help">Created automatically from the restaurant name.</span></label>
            </div>
            <div className="cuisine-grid">
              {cuisineOptions.map((cuisine) => (
                <button className={cuisines.includes(cuisine) ? 'cuisine-chip selected' : 'cuisine-chip'} type="button" key={cuisine} onClick={() => setCuisines((current) => current.includes(cuisine) ? current.filter((item) => item !== cuisine) : [...current, cuisine])}>
                  {cuisines.includes(cuisine) ? '✓ ' : ''}{cuisine}
                </button>
              ))}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void saveDetails()} saving={saving} />
          </div>
        )}

        {!pending && step === STEP.address && (
          <div className="onboarding-step">
            <span className="eyebrow">Trading address</span>
            <h1>Where do you trade from?</h1>
            <p>This primary location is used for collection, delivery distances and your application review.</p>
            <div className="form-grid">
              <label className="large-field full-width">Address line 1<input value={line1} onChange={(event) => setLine1(event.target.value)} placeholder="12 High Street" /></label>
              <label className="large-field full-width">Address line 2 <span className="optional-label">Optional</span><input value={line2} onChange={(event) => setLine2(event.target.value)} /></label>
              <label className="large-field">Town or city<input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Bangor" /></label>
              <label className="large-field">Postcode<input value={postcode} onChange={(event) => setPostcode(event.target.value.toUpperCase())} placeholder="BT20 5AA" /></label>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void saveAddress()} saving={saving} />
          </div>
        )}

        {!pending && step === STEP.contact && (
          <div className="onboarding-step">
            <span className="eyebrow">Contact details</span>
            <h1>How should we contact the restaurant?</h1>
            <p>We use these details for application and order communication.</p>
            <div className="form-grid">
              <label className="large-field">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="orders@restaurant.co.uk" /></label>
              <label className="large-field">Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="028 9000 0000" /></label>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void saveContact()} saving={saving} />
          </div>
        )}

        {!pending && step === STEP.fulfilment && (
          <div className="onboarding-step">
            <span className="eyebrow">Delivery and collection</span>
            <h1>How can customers order?</h1>
            <p>Choose at least one method and set the charges shown at checkout.</p>
            <div className="service-option-grid">
              <label className={acceptsDelivery ? 'service-option selected' : 'service-option'}><input type="checkbox" checked={acceptsDelivery} onChange={(event) => setAcceptsDelivery(event.target.checked)} /><strong>Delivery</strong><small>Deliver to customer addresses.</small></label>
              <label className={acceptsCollection ? 'service-option selected' : 'service-option'}><input type="checkbox" checked={acceptsCollection} onChange={(event) => setAcceptsCollection(event.target.checked)} /><strong>Collection</strong><small>Customers collect from the restaurant.</small></label>
            </div>
            <div className="form-grid onboarding-money-grid">
              <label className="large-field">Minimum order (£)<input inputMode="decimal" value={minimumOrder} onChange={(event) => setMinimumOrder(event.target.value)} /></label>
              <label className="large-field">Preparation time (minutes)<input type="number" min="5" max="240" value={preparationTime} onChange={(event) => setPreparationTime(event.target.value)} /></label>
              {acceptsDelivery && <><label className="large-field">Delivery fee (£)<input inputMode="decimal" value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} /></label><label className="large-field">Delivery radius (miles)<input type="number" min="0.1" step="0.1" value={deliveryRadius} onChange={(event) => setDeliveryRadius(event.target.value)} /></label></>}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void saveFulfilment()} saving={saving} />
          </div>
        )}

        {!pending && step === STEP.hours && (
          <div className="onboarding-step">
            <span className="eyebrow">Opening hours</span>
            <h1>When are you open?</h1>
            <p>Add all seven days. Mark any non-trading days as closed.</p>
            <div className="hours-list onboarding-hours">
              {hours.map((day) => (
                <div className={day.is_closed ? 'hours-row closed' : 'hours-row'} key={day.day_of_week}>
                  <div className="hours-day"><strong>{day.label}</strong><label className="closed-toggle"><input type="checkbox" checked={day.is_closed} onChange={(event) => updateDay(day.day_of_week, { is_closed: event.target.checked })} />Closed</label></div>
                  <div className="time-fields"><label>Opens<input type="time" value={day.open_time} disabled={day.is_closed} onChange={(event) => updateDay(day.day_of_week, { open_time: event.target.value })} /></label><span>to</span><label>Closes<input type="time" value={day.close_time} disabled={day.is_closed} onChange={(event) => updateDay(day.day_of_week, { close_time: event.target.value })} /></label></div>
                </div>
              ))}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void saveHours()} saving={saving} />
          </div>
        )}

        {!pending && step === STEP.upload && (
          <div className="onboarding-step">
            <span className="eyebrow">{menuReupload ? 'Replace menu' : 'Menu sections'}</span>
            <h1>{menuReupload ? 'Upload your new menu.' : 'Add your menu one section at a time.'}</h1>
            <p>{menuReupload ? 'Your old menu has been cleared. Name each section, upload its PDF page or image, review it, then add the next section.' : 'Name this section yourself, add any instructions for the AI, then upload the page or image that contains it.'}</p>
            {counts.items > 0 && (
              <div className="existing-menu-summary"><strong>Menu so far</strong><span>{counts.categories} confirmed sections · {counts.items} items</span><button className="primary-button" type="button" onClick={() => void completeMenu()} disabled={saving}>My menu is complete</button></div>
            )}
            {success && <div className="form-success" role="status">{success}</div>}
            <div className="menu-section-setup">
              <label className="large-field full-width">Section name<input value={sectionName} onChange={(event) => setSectionName(event.target.value)} placeholder="e.g. Starters, Beginnings or Chef's Specials" /></label>
              <label className="large-field full-width">Instructions for the AI <span className="optional-label">Optional</span><textarea rows={3} value={sectionInstructions} onChange={(event) => setSectionInstructions(event.target.value)} placeholder="e.g. Every dish can be chicken, beef or pork. Beef costs £1 extra." /><span className="field-help">These instructions apply only to this section. You can check the result before confirming it.</span></label>
            </div>
            <div className={dragging ? 'menu-dropzone dragging' : 'menu-dropzone'} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
              <span aria-hidden="true">↑</span><strong>Upload this section</strong><p>Choose a PDF, JPG, PNG or WebP file · maximum 15 MB</p>
              <input ref={fileInputRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleMenuFile(file) }} />
            </div>
            {saving && <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress < 70 ? 'Uploading menu…' : 'Starting AI scan…'}</small></div>}
            {menuImport?.status === 'failed' && <div className="scan-failure"><strong>Previous scan failed</strong><p>{menuImport.error_message || 'The menu could not be scanned.'}</p><button className="secondary-button" type="button" onClick={() => void retryScan()} disabled={saving}>Retry scan</button></div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="onboarding-actions"><button className="text-button" type="button" onClick={() => menuReupload ? navigate('/menu') : back()} disabled={saving}>{menuReupload ? 'Cancel and return to menu' : 'Back'}</button></div>
          </div>
        )}

        {!pending && step === STEP.scanning && (
          <div className="onboarding-step onboarding-welcome">
            <div className="scan-spinner" aria-hidden="true" />
            <span className="eyebrow">AI menu scan</span>
            <h1>Reading {sectionName || 'this section'}…</h1>
            <p>We are extracting the products, descriptions, prices and dietary information from {menuImport?.file_name || 'your upload'}. You can safely leave this page and return later.</p>
            <div className="success-reference">The original upload and scan progress are saved</div>
            {menuImport?.status === 'queued' && <button className="primary-button" type="button" onClick={() => void retryScan()} disabled={saving}>{saving ? 'Starting scan…' : 'Resume AI scan'}</button>}
            {error && <div className="form-error" role="alert">{error}</div>}
          </div>
        )}

        {!pending && step === STEP.menuReview && (
          <div className="onboarding-step">
            <span className="eyebrow">Review section</span>
            <h1>Check {extractedMenu.categories[0]?.name || sectionName || 'this section'}.</h1>
            <p>Correct the name, items and prices. Confirming saves this section, then you can add another.</p>
            {extractedMenu.warnings.length > 0 && <div className="confidence-warning"><strong>Scan notes</strong>{extractedMenu.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>}
            <div className="scanned-menu-editor">
              {extractedMenu.categories.map((category, categoryIndex) => (
                <article className="scanned-category" key={`category-${categoryIndex}`}>
                  <div className="scanned-category-heading">
                    <input value={category.name} onChange={(event) => updateCategory(categoryIndex, { name: event.target.value })} aria-label="Category name" />
                    <button className="danger-text-button" type="button" onClick={() => setExtractedMenu((current) => ({ ...current, categories: current.categories.filter((_, index) => index !== categoryIndex) }))}>Remove category</button>
                  </div>
                  <div className="scanned-items">
                    {category.items.map((item, itemIndex) => (
                      <div className={item.confidence !== null && item.confidence < 0.7 ? 'scanned-item low-confidence' : 'scanned-item'} key={`item-${itemIndex}`}>
                        {item.confidence !== null && item.confidence < 0.7 && <span className="low-confidence-label">Low confidence · check this item</span>}
                        <div className="form-grid">
                          <label className="large-field">Item name<input value={item.name} onChange={(event) => updateItem(categoryIndex, itemIndex, { name: event.target.value })} /></label>
                          <label className="large-field">Price (£)<input inputMode="decimal" value={item.price} onChange={(event) => updateItem(categoryIndex, itemIndex, { price: event.target.value })} /></label>
                          <label className="large-field full-width">Description<textarea rows={2} value={item.description} onChange={(event) => updateItem(categoryIndex, itemIndex, { description: event.target.value })} /></label>
                        </div>
                        <div className="dietary-options"><label><input type="checkbox" checked={item.vegetarian} onChange={(event) => updateItem(categoryIndex, itemIndex, { vegetarian: event.target.checked })} /> Vegetarian</label><label><input type="checkbox" checked={item.vegan} onChange={(event) => updateItem(categoryIndex, itemIndex, { vegan: event.target.checked, vegetarian: event.target.checked || item.vegetarian })} /> Vegan</label><button className="danger-text-button" type="button" onClick={() => removeItem(categoryIndex, itemIndex)}>Remove item</button></div>
                        {item.warnings.map((warning, index) => <small className="item-warning" key={`${warning}-${index}`}>{warning}</small>)}
                      </div>
                    ))}
                  </div>
                  <button className="secondary-button" type="button" onClick={() => updateCategory(categoryIndex, { items: [...category.items, { name: '', description: '', price_pence: null, price: '', vegetarian: false, vegan: false, confidence: null, warnings: [] }] })}>+ Add item</button>
                </article>
              ))}
            </div>
            {extractedMenu.modifier_groups.length > 0 && <div className="scanned-modifiers"><h2>Customer choices</h2><p>Choose exactly which dishes each option belongs to.</p>{extractedMenu.modifier_groups.map((group, groupIndex) => {
              const dishNames = extractedMenu.categories.flatMap((category) => category.items.map((item) => item.name.trim())).filter(Boolean)
              const appliesToAll = group.applies_to_item_names.length === 0
              return <article className="scanned-category" key={`modifier-${groupIndex}`}><div className="form-grid"><label className="large-field full-width">Choice name<input value={group.name} onChange={(event) => updateModifierGroup(groupIndex, { name: event.target.value })} /></label><fieldset className="modifier-dish-picker full-width"><legend>Which dishes does this apply to?</legend><div className="modifier-dish-list">{dishNames.map((itemName, itemIndex) => { const selected = appliesToAll || group.applies_to_item_names.some((name) => name.trim().toLocaleLowerCase() === itemName.toLocaleLowerCase()); return <button className={selected ? 'selected' : ''} type="button" aria-pressed={selected} onClick={() => toggleModifierDish(groupIndex, itemName)} key={`${itemName}-${itemIndex}`}><span aria-hidden="true">{selected ? '✓' : '+'}</span>{itemName}</button> })}</div><span className="field-help">Tap the dishes this choice applies to. Selecting one dish or every dish works the same way.</span></fieldset></div><div className="scanned-items">{group.options.map((option, optionIndex) => <div className="scanned-item" key={`option-${optionIndex}`}><div className="form-grid"><label className="large-field">Option<input value={option.name} onChange={(event) => updateModifierGroup(groupIndex, { options: group.options.map((value, index) => index === optionIndex ? { ...value, name: event.target.value } : value) })} /></label><label className="large-field">Extra charge (£)<input inputMode="decimal" value={option.price} onChange={(event) => updateModifierGroup(groupIndex, { options: group.options.map((value, index) => index === optionIndex ? { ...value, price: event.target.value } : value) })} /></label></div></div>)}</div><button className="danger-text-button" type="button" onClick={() => setExtractedMenu((current) => ({ ...current, modifier_groups: current.modifier_groups.filter((_, index) => index !== groupIndex) }))}>Remove choice</button></article>
            })}</div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={() => setStep(STEP.upload)} onContinue={() => void importScannedMenu()} saving={saving} continueLabel="Confirm this section" />
          </div>
        )}

        {!pending && step === STEP.branding && (
          <div className="onboarding-step">
            <span className="eyebrow">Branding and images</span>
            <h1>Make the storefront yours.</h1>
            <p>Add a square logo and a wide food or restaurant image. You can replace either later.</p>
            <div className="onboarding-brand-grid">
              <label className="brand-upload-card">
                <span className="brand-preview logo-preview">{restaurant?.logo_url ? <img src={restaurant.logo_url} alt="" /> : 'Logo'}</span>
                <strong>{restaurant?.logo_url ? 'Change logo' : 'Upload logo'}</strong>
                <small>JPG, PNG or WebP</small>
                <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadBrandAsset('logo', event)} disabled={saving} />
              </label>
              <label className="brand-upload-card">
                <span className="brand-preview cover-preview">{restaurant?.cover_url ? <img src={restaurant.cover_url} alt="" /> : 'Cover image'}</span>
                <strong>{restaurant?.cover_url ? 'Change cover' : 'Upload cover'}</strong>
                <small>JPG, PNG or WebP</small>
                <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadBrandAsset('cover', event)} disabled={saving} />
              </label>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            {success && <div className="form-success" role="status">{success}</div>}
            <StepActions onBack={back} onContinue={() => void finishBranding()} saving={saving} continueLabel={restaurant?.logo_url || restaurant?.cover_url ? 'Save and continue' : 'Skip for now'} />
          </div>
        )}

        {!pending && step === STEP.payments && (
          <div className="onboarding-step">
            <span className="eyebrow">Payment setup</span>
            <h1>Payment onboarding is coming next.</h1>
            <p>Customer card payments already use secure Stripe Checkout. A restaurant Stripe Connect account setup action is not yet available in this project, so we cannot truthfully mark payouts as connected.</p>
            <div className="payment-status-card"><span>!</span><div><strong>Restaurant payouts not connected</strong><p>This does not block saving or submitting the rest of your application. The ordered.food team must complete the Stripe Connect integration before restaurants can receive payouts.</p></div></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <StepActions onBack={back} onContinue={() => void finishPayments()} saving={saving} continueLabel="Acknowledge and continue" />
          </div>
        )}

        {!pending && step === STEP.applicationReview && (
          <div className="onboarding-step">
            <span className="eyebrow">Review application</span>
            <h1>Check everything before submitting.</h1>
            <p>Your restaurant remains a draft until you submit this application.</p>
            <div className="application-summary">
              <article><div><strong>Restaurant</strong><button type="button" onClick={() => setStep(STEP.details)}>Edit</button></div><p>{name}</p><small>{cuisines.join(' · ')}</small></article>
              <article><div><strong>Trading address</strong><button type="button" onClick={() => setStep(STEP.address)}>Edit</button></div><p>{[line1, line2, city, postcode].filter(Boolean).join(', ')}</p></article>
              <article><div><strong>Contact</strong><button type="button" onClick={() => setStep(STEP.contact)}>Edit</button></div><p>{email} · {phone}</p></article>
              <article><div><strong>Orders</strong><button type="button" onClick={() => setStep(STEP.fulfilment)}>Edit</button></div><p>{[acceptsDelivery && 'Delivery', acceptsCollection && 'Collection'].filter(Boolean).join(' and ')}</p><small>Minimum {money.format(pence(minimumOrder) / 100)}{acceptsDelivery ? ` · ${money.format(pence(deliveryFee) / 100)} delivery` : ''}</small></article>
              <article><div><strong>Opening hours</strong><button type="button" onClick={() => setStep(STEP.hours)}>Edit</button></div><p>Seven days supplied · {hours.filter((day) => !day.is_closed).length} trading days</p></article>
              <article><div><strong>Menu</strong><button type="button" onClick={() => setStep(STEP.upload)}>Edit</button></div><p>{counts.categories} categories · {counts.items} items</p></article>
              <article><div><strong>Branding</strong><button type="button" onClick={() => setStep(STEP.branding)}>Edit</button></div><p>{[restaurant?.logo_url && 'Logo', restaurant?.cover_url && 'Cover image'].filter(Boolean).join(' and ') || 'No images uploaded'}</p></article>
              <article><div><strong>Payments</strong><button type="button" onClick={() => setStep(STEP.payments)}>Review</button></div><p>Stripe Connect payouts not yet integrated</p></article>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            {missingRequirements.length > 0 && <div className="missing-requirements">{missingRequirements.map((requirement) => <button type="button" key={requirement} onClick={() => setStep(requirementStep(requirement))}>{requirement}<span>Fix →</span></button>)}</div>}
            <StepActions onBack={back} onContinue={() => void submitApplication()} saving={saving} continueLabel="Submit application" />
          </div>
        )}
      </section>
    </main>
  )
}
