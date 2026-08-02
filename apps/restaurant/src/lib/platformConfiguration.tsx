import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import './platformConfiguration.css'

export type PublicPlatformConfiguration = {
  maintenance_mode: boolean
  maintenance_title: string
  maintenance_message: string
  ordering_enabled: boolean
  ordering_pause_message: string
  feature_flags: {
    scheduled_orders: boolean
    customer_favourites: boolean
    restaurant_quick_availability: boolean
  }
  updated_at: string | null
}

const safeDefaults: PublicPlatformConfiguration = {
  maintenance_mode: false,
  maintenance_title: 'We will be back shortly',
  maintenance_message: 'ordered.food is temporarily unavailable while we carry out essential maintenance.',
  ordering_enabled: true,
  ordering_pause_message: 'Online ordering is temporarily paused. You can still browse restaurants and track existing orders.',
  feature_flags: {
    scheduled_orders: true,
    customer_favourites: true,
    restaurant_quick_availability: true,
  },
  updated_at: null,
}

const PlatformConfigurationContext = createContext({ configuration: safeDefaults, loading: true, refresh: async () => {} })

export function PlatformConfigurationProvider({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState(safeDefaults)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_public_platform_configuration')
    if (!error && data) setConfiguration(data as PublicPlatformConfiguration)
    else if (error) console.warn('Unable to refresh platform configuration', error.message)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 60_000)
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [refresh])

  return <PlatformConfigurationContext.Provider value={{ configuration, loading, refresh }}>{children}</PlatformConfigurationContext.Provider>
}

export function usePlatformConfiguration() {
  return useContext(PlatformConfigurationContext)
}

export function PlatformStatusBoundary({ children }: { children: ReactNode }) {
  const { configuration, loading } = usePlatformConfiguration()
  const location = useLocation()
  const orderingSurface = location.pathname === '/'
    || location.pathname === '/restaurants'
    || location.pathname.startsWith('/r/')
  const checkoutSurface = /^\/r\/[^/]+\/checkout\/?$/.test(location.pathname)

  if (!loading && orderingSurface && configuration.maintenance_mode) {
    return <PlatformUnavailable title={configuration.maintenance_title} message={configuration.maintenance_message} maintenance />
  }
  if (!loading && checkoutSurface && !configuration.ordering_enabled) {
    return <PlatformUnavailable title="Online ordering is paused" message={configuration.ordering_pause_message} />
  }

  return <>
    {!loading && orderingSurface && !configuration.ordering_enabled && <div className="platform-status-banner" role="status"><strong>Online ordering paused</strong><span>{configuration.ordering_pause_message}</span></div>}
    {children}
  </>
}

function PlatformUnavailable({ title, message, maintenance = false }: { title: string; message: string; maintenance?: boolean }) {
  return <main className="platform-unavailable-page">
    <section>
      <Link className="platform-unavailable-logo" to="/">ordered.food</Link>
      <span className="platform-unavailable-icon" aria-hidden="true">{maintenance ? '◷' : 'Ⅱ'}</span>
      <small>{maintenance ? 'Scheduled maintenance' : 'Ordering update'}</small>
      <h1>{title}</h1>
      <p>{message}</p>
      <div><Link to="/account/orders">Track an existing order</Link><Link to="/login">Restaurant login</Link></div>
    </section>
  </main>
}
