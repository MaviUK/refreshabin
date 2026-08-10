import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './BuyGiftCard.css'

type FinalizeResponse = {
  status?: string
  restaurant_name?: string
  restaurant_slug?: string
  delivery_at?: string
  email_sent?: boolean
  scheduled?: boolean
  error?: string
}

export default function GiftCardSuccess() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const [result, setResult] = useState<FinalizeResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const sessionId = searchParams.get('session_id')
    if (!sessionId) {
      setError('The payment session could not be found.')
      return
    }
    async function finalize() {
      const { data, error: invokeError } = await supabase.functions.invoke<FinalizeResponse>('finalize-gift-card-purchase', { body: { session_id: sessionId } })
      if (invokeError || !data || data.error) setError(data?.error || invokeError?.message || 'Gift card payment could not be verified.')
      else setResult(data)
    }
    void finalize()
  }, [searchParams])

  if (!result && !error) return <main className="buy-gift-card-state"><h1>Preparing your gift card…</h1><p>We are verifying the secure payment and issuing the gift card.</p></main>

  if (error) return <main className="buy-gift-card-state"><h1>We could not finish the gift card</h1><p>{error}</p><p>Your payment status can still be checked safely by support.</p><Link to={slug ? `/r/${slug}` : '/restaurants'}>Return to restaurant</Link></main>

  const scheduledDate = result?.delivery_at ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(result.delivery_at)) : ''
  return (
    <main className="buy-gift-card-state">
      <h1>Gift card purchased</h1>
      <p>{result?.scheduled ? `The gift card will be emailed on ${scheduledDate}.` : result?.email_sent ? 'The gift card has been emailed to the recipient.' : 'The gift card has been issued and is ready for delivery.'}</p>
      <Link to={result?.restaurant_slug ? `/r/${result.restaurant_slug}` : slug ? `/r/${slug}` : '/restaurants'}>Return to {result?.restaurant_name || 'restaurant'}</Link>
    </main>
  )
}
