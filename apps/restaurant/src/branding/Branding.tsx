import { useEffect, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type AssetType = 'logo' | 'cover'

type RestaurantBranding = {
  id: string
  name: string
  cuisines: string[] | null
  logo_url: string | null
  cover_url: string | null
}

const assetConfig = {
  logo: { width: 720, height: 720, quality: 0.88 },
  cover: { width: 1800, height: 900, quality: 0.88 },
}

async function optimiseImage(file: File, type: AssetType) {
  const config = assetConfig[type]
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = config.width
  canvas.height = config.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not process this image.')

  const sourceRatio = bitmap.width / bitmap.height
  const targetRatio = config.width / config.height
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

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    config.width,
    config.height,
  )

  bitmap.close()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The image could not be converted.')),
      'image/webp',
      config.quality,
    )
  })
}

export default function Branding() {
  const [restaurant, setRestaurant] = useState<RestaurantBranding | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<AssetType | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    void loadRestaurant()
  }, [])

  async function loadRestaurant() {
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
      .select('restaurant_id')
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

    const { data, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name, cuisines, logo_url, cover_url')
      .eq('id', membership.restaurant_id)
      .single()

    if (restaurantError) setError(restaurantError.message)
    else setRestaurant(data as RestaurantBranding)

    setLoading(false)
  }

  async function uploadAsset(type: AssetType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !restaurant) return

    if (!file.type.startsWith('image/')) {
      setError('Choose a JPG, PNG or WebP image.')
      return
    }

    if (file.size > 12 * 1024 * 1024) {
      setError('Choose an image smaller than 12 MB.')
      return
    }

    setUploading(type)
    setError('')
    setSuccess('')

    try {
      const optimised = await optimiseImage(file, type)
      const path = `${restaurant.id}/${type}.webp`
      const { error: uploadError } = await supabase.storage
        .from('restaurant-assets')
        .upload(path, optimised, { contentType: 'image/webp', upsert: true })

      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage
        .from('restaurant-assets')
        .getPublicUrl(path)

      const url = `${publicUrlData.publicUrl}?v=${Date.now()}`
      const field = type === 'logo' ? 'logo_url' : 'cover_url'
      const { error: updateError } = await supabase
        .from('restaurants')
        .update({ [field]: url })
        .eq('id', restaurant.id)

      if (updateError) throw updateError

      setRestaurant((current) => current ? { ...current, [field]: url } : current)
      setSuccess(`${type === 'logo' ? 'Logo' : 'Cover image'} updated.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The image could not be uploaded.')
    } finally {
      setUploading(null)
    }
  }

  async function removeAsset(type: AssetType) {
    if (!restaurant) return

    setUploading(type)
    setError('')
    setSuccess('')

    const path = `${restaurant.id}/${type}.webp`
    const field = type === 'logo' ? 'logo_url' : 'cover_url'
    const { error: storageError } = await supabase.storage.from('restaurant-assets').remove([path])
    const { error: updateError } = await supabase.from('restaurants').update({ [field]: null }).eq('id', restaurant.id)

    setUploading(null)

    if (storageError || updateError) {
      setError(storageError?.message || updateError?.message || 'The image could not be removed.')
      return
    }

    setRestaurant((current) => current ? { ...current, [field]: null } : current)
    setSuccess(`${type === 'logo' ? 'Logo' : 'Cover image'} removed.`)
  }

  if (loading) {
    return <main className="portal-shell"><div className="menu-state-card">Loading your branding…</div></main>
  }

  if (!restaurant) {
    return (
      <main className="portal-shell">
        <div className="menu-state-card">
          <span className="eyebrow">Restaurant branding</span>
          <h1>Create your restaurant first.</h1>
          <p>Complete setup before uploading your logo and cover image.</p>
          <Link className="primary-button button-link" to="/onboarding">Start setup</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurant.name} · Branding</p>
        </div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="page-heading-row">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h1>Restaurant branding</h1>
          <p>Upload polished images once and use them across your storefront, checkout and customer messages.</p>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {success && <div className="form-success" role="status">{success}</div>}

      <section className="branding-grid">
        <div className="branding-controls">
          <article className="upload-card">
            <div className="upload-copy">
              <span className="asset-icon">◎</span>
              <div>
                <h2>Restaurant logo</h2>
                <p>Square images work best. We crop and optimise it automatically.</p>
              </div>
            </div>
            <div className="upload-actions">
              <label className="primary-button file-button">
                {uploading === 'logo' ? 'Uploading…' : restaurant.logo_url ? 'Change logo' : 'Upload logo'}
                <input accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => void uploadAsset('logo', event)} disabled={uploading !== null} />
              </label>
              {restaurant.logo_url && <button className="text-button danger-text" type="button" onClick={() => void removeAsset('logo')} disabled={uploading !== null}>Remove</button>}
            </div>
          </article>

          <article className="upload-card">
            <div className="upload-copy">
              <span className="asset-icon">▣</span>
              <div>
                <h2>Cover image</h2>
                <p>Use a wide, bright photo of your food, team or restaurant.</p>
              </div>
            </div>
            <div className="upload-actions">
              <label className="primary-button file-button">
                {uploading === 'cover' ? 'Uploading…' : restaurant.cover_url ? 'Change cover' : 'Upload cover'}
                <input accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => void uploadAsset('cover', event)} disabled={uploading !== null} />
              </label>
              {restaurant.cover_url && <button className="text-button danger-text" type="button" onClick={() => void removeAsset('cover')} disabled={uploading !== null}>Remove</button>}
            </div>
          </article>
        </div>

        <aside className="storefront-preview-card">
          <span className="preview-label">Live customer preview</span>
          <div className="storefront-cover" style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}>
            {!restaurant.cover_url && <span>Add a cover photo</span>}
          </div>
          <div className="storefront-body">
            <div className="storefront-logo">
              {restaurant.logo_url ? <img src={restaurant.logo_url} alt={`${restaurant.name} logo`} /> : <span>{restaurant.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="storefront-copy">
              <div className="open-pill">Open</div>
              <h2>{restaurant.name}</h2>
              <p>{restaurant.cuisines?.length ? restaurant.cuisines.join(' · ') : 'Add your cuisines in restaurant setup'}</p>
              <div className="storefront-meta"><span>Collection</span><span>Delivery</span><span>20–35 min</span></div>
            </div>
            <button className="primary-button storefront-button" type="button">Start order</button>
          </div>
        </aside>
      </section>
    </main>
  )
}
