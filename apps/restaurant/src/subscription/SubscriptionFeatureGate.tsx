import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSubscriptionAccess, type SubscriptionFeature } from './SubscriptionAccess'
import './SubscriptionFeatureGate.css'

type Props = {
  feature: SubscriptionFeature
  title: string
  description: string
  children: ReactNode
  compact?: boolean
}

export default function SubscriptionFeatureGate({ feature, title, description, children, compact = false }: Props) {
  const access = useSubscriptionAccess()

  if (access.loading) return <div className="subscription-gate subscription-gate--loading">Checking plan access…</div>
  if (access.hasFeature(feature)) return <>{children}</>

  return (
    <section className={`subscription-gate${compact ? ' subscription-gate--compact' : ''}`}>
      <span className="subscription-gate__badge">Premium feature</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <p className="subscription-gate__current">Current plan: <strong>{access.planName ?? 'No active plan'}</strong></p>
      <Link className="primary-button button-link" to="/subscription">View plans and upgrade</Link>
    </section>
  )
}
