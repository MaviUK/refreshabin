import { Link, useParams } from 'react-router-dom'
import './StorefrontGiftCardButton.css'

export default function StorefrontGiftCardButton() {
  const { slug } = useParams()
  if (!slug) return null
  return <Link className="storefront-gift-card-button" to={`/r/${slug}/gift-card`} aria-label="Buy a gift card for this restaurant"><span aria-hidden="true">◇</span><span><strong>Buy a gift card</strong><small>Send now or schedule it</small></span></Link>
}
