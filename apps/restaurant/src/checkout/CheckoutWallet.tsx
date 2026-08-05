import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './CheckoutWallet.css'

type GiftCardValidation = { valid: boolean; error?: string; code_suffix?: string; available_pence?: number }
type CheckoutBalances = { credit_balance_pence: number }

export type WalletSelection = {
  giftCardCode: string
  giftCardAppliedPence: number
  creditAppliedPence: number
}

type Props = {
  restaurantId: string
  totalPence: number
  signedIn: boolean
  disabled?: boolean
  onChange: (selection: WalletSelection) => void
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export default function CheckoutWallet({ restaurantId, totalPence, signedIn, disabled = false, onChange }: Props) {
  const [giftCardCode, setGiftCardCode] = useState('')
  const [giftCard, setGiftCard] = useState<GiftCardValidation | null>(null)
  const [giftCardError, setGiftCardError] = useState('')
  const [giftCardBusy, setGiftCardBusy] = useState(false)
  const [creditBalance, setCreditBalance] = useState(0)
  const [useCredit, setUseCredit] = useState(false)

  useEffect(() => {
    let active = true
    async function loadBalances() {
      if (!signedIn) {
        setCreditBalance(0)
        setUseCredit(false)
        return
      }
      const { data } = await supabase.rpc('get_customer_checkout_balances', { p_restaurant_id: restaurantId })
      if (active && data) setCreditBalance(Number((data as CheckoutBalances).credit_balance_pence || 0))
    }
    void loadBalances()
    return () => { active = false }
  }, [restaurantId, signedIn])

  const giftCardAppliedPence = Math.min(totalPence, giftCard?.available_pence || 0)
  const remainingAfterGiftCard = Math.max(totalPence - giftCardAppliedPence, 0)
  const creditAppliedPence = useCredit ? Math.min(remainingAfterGiftCard, creditBalance) : 0

  const selection = useMemo<WalletSelection>(() => ({
    giftCardCode: giftCard ? giftCardCode.trim().toUpperCase() : '',
    giftCardAppliedPence,
    creditAppliedPence,
  }), [creditAppliedPence, giftCard, giftCardAppliedPence, giftCardCode])

  useEffect(() => { onChange(selection) }, [onChange, selection])

  useEffect(() => {
    if (giftCard && giftCardAppliedPence === 0) {
      setGiftCard(null)
      setGiftCardError('This gift card no longer has an available balance for the current total.')
    }
  }, [giftCard, giftCardAppliedPence])

  async function applyGiftCard() {
    if (!giftCardCode.trim() || giftCardBusy) return
    setGiftCardBusy(true)
    setGiftCardError('')
    setGiftCard(null)
    const { data, error } = await supabase.rpc('validate_restaurant_gift_card', {
      p_restaurant_id: restaurantId,
      p_code: giftCardCode.trim(),
    })
    if (error) setGiftCardError(error.message)
    else {
      const validation = data as GiftCardValidation
      if (!validation.valid || !validation.available_pence) setGiftCardError(validation.error || 'This gift card cannot be used.')
      else setGiftCard(validation)
    }
    setGiftCardBusy(false)
  }

  return <section className="checkout-wallet" aria-label="Gift cards and store credit">
    <div className="checkout-wallet-heading"><div><span>Wallet</span><strong>Gift cards & store credit</strong></div><small>Balances are reserved securely when your order is created.</small></div>
    <label htmlFor="gift-card-code">Gift card code</label>
    <div className="checkout-wallet-row">
      <input id="gift-card-code" value={giftCardCode} onChange={(event) => { setGiftCardCode(event.target.value.toUpperCase()); setGiftCard(null); setGiftCardError('') }} placeholder="OF-…" disabled={disabled || giftCardBusy} />
      <button type="button" onClick={() => void applyGiftCard()} disabled={disabled || giftCardBusy || !giftCardCode.trim()}>{giftCardBusy ? 'Checking…' : 'Apply'}</button>
    </div>
    {giftCard && <div className="checkout-wallet-success"><span>✓ Card ending {giftCard.code_suffix} · {money.format((giftCard.available_pence || 0) / 100)} available</span><button type="button" onClick={() => { setGiftCard(null); setGiftCardCode('') }} disabled={disabled}>Remove</button></div>}
    {giftCardError && <p className="checkout-wallet-error">{giftCardError}</p>}

    {signedIn ? <label className="checkout-credit-toggle"><input type="checkbox" checked={useCredit} onChange={(event) => setUseCredit(event.target.checked)} disabled={disabled || creditBalance <= 0} /><span><strong>Use store credit</strong><small>{creditBalance > 0 ? `${money.format(creditBalance / 100)} available` : 'No store credit available for this restaurant'}</small></span></label> : <p className="checkout-wallet-signin">Sign in or create your account to use store credit.</p>}

    {(giftCardAppliedPence > 0 || creditAppliedPence > 0) && <div className="checkout-wallet-applied">
      {giftCardAppliedPence > 0 && <div><span>Gift card</span><strong>-{money.format(giftCardAppliedPence / 100)}</strong></div>}
      {creditAppliedPence > 0 && <div><span>Store credit</span><strong>-{money.format(creditAppliedPence / 100)}</strong></div>}
    </div>}
  </section>
}
