import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './CheckoutWallet.css'

type GiftCardValidation = { valid: boolean; error?: string; code_suffix?: string; available_pence?: number }
type CheckoutBalances = { credit_balance_pence: number }
type RewardVoucher = { voucher_id: string; code: string; reward_name: string; reward_type: string; fixed_value_pence?: number | null; percentage_basis_points?: number | null; menu_item_id?: string | null; minimum_order_pence: number; expires_at?: string | null }

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

function rewardEstimate(reward: RewardVoucher | null, totalPence: number) {
  if (!reward || totalPence < reward.minimum_order_pence) return 0
  if (reward.reward_type === 'percentage_discount') return Math.min(totalPence, Math.round(totalPence * Number(reward.percentage_basis_points || 0) / 10000))
  if (['fixed_discount', 'wallet_credit'].includes(reward.reward_type)) return Math.min(totalPence, Number(reward.fixed_value_pence || 0))
  return 0
}

export default function CheckoutWallet({ restaurantId, totalPence, signedIn, disabled = false, onChange }: Props) {
  const [giftCardCode, setGiftCardCode] = useState('')
  const [giftCard, setGiftCard] = useState<GiftCardValidation | null>(null)
  const [giftCardError, setGiftCardError] = useState('')
  const [giftCardBusy, setGiftCardBusy] = useState(false)
  const [creditBalance, setCreditBalance] = useState(0)
  const [useCredit, setUseCredit] = useState(false)
  const [rewards, setRewards] = useState<RewardVoucher[]>([])
  const [selectedRewardId, setSelectedRewardId] = useState('')
  const selectedReward = rewards.find((reward) => reward.voucher_id === selectedRewardId) || null

  useEffect(() => {
    let active = true
    async function loadWallet() {
      if (!signedIn) {
        setCreditBalance(0); setUseCredit(false); setRewards([]); setSelectedRewardId(''); return
      }
      const [{ data: balances }, { data: vouchers }] = await Promise.all([
        supabase.rpc('get_customer_checkout_balances', { p_restaurant_id: restaurantId }),
        supabase.rpc('get_checkout_reward_vouchers', { p_restaurant_id: restaurantId }),
      ])
      if (!active) return
      if (balances) setCreditBalance(Number((balances as CheckoutBalances).credit_balance_pence || 0))
      setRewards(Array.isArray(vouchers) ? vouchers as RewardVoucher[] : [])
    }
    void loadWallet()
    return () => { active = false }
  }, [restaurantId, signedIn])

  const rewardAppliedPence = rewardEstimate(selectedReward, totalPence)
  const remainingAfterReward = Math.max(totalPence - rewardAppliedPence, 0)
  const giftCardAppliedPence = Math.min(remainingAfterReward, giftCard?.available_pence || 0)
  const remainingAfterGiftCard = Math.max(remainingAfterReward - giftCardAppliedPence, 0)
  const creditAppliedPence = useCredit ? Math.min(remainingAfterGiftCard, creditBalance) : 0

  const selection = useMemo<WalletSelection>(() => {
    const cardCode = giftCard ? giftCardCode.trim().toUpperCase() : ''
    const encodedCode = selectedRewardId ? `REWARD:${selectedRewardId}|GIFT:${cardCode}` : cardCode
    return { giftCardCode: encodedCode, giftCardAppliedPence: giftCardAppliedPence + rewardAppliedPence, creditAppliedPence }
  }, [creditAppliedPence, giftCard, giftCardAppliedPence, giftCardCode, rewardAppliedPence, selectedRewardId])

  useEffect(() => { onChange(selection) }, [onChange, selection])

  async function applyGiftCard() {
    if (!giftCardCode.trim() || giftCardBusy) return
    setGiftCardBusy(true); setGiftCardError(''); setGiftCard(null)
    const { data, error } = await supabase.rpc('validate_restaurant_gift_card', { p_restaurant_id: restaurantId, p_code: giftCardCode.trim() })
    if (error) setGiftCardError(error.message)
    else {
      const validation = data as GiftCardValidation
      if (!validation.valid || !validation.available_pence) setGiftCardError(validation.error || 'This gift card cannot be used.')
      else setGiftCard(validation)
    }
    setGiftCardBusy(false)
  }

  return <section className="checkout-wallet" aria-label="Rewards, gift cards and store credit">
    <div className="checkout-wallet-heading"><div><span>Wallet</span><strong>Rewards, gift cards & store credit</strong></div><small>Selected balances are reserved securely when your order is created.</small></div>

    {signedIn && rewards.length > 0 && <label>Reward voucher
      <select value={selectedRewardId} onChange={(event) => setSelectedRewardId(event.target.value)} disabled={disabled}>
        <option value="">Do not use a reward</option>
        {rewards.map((reward) => <option key={reward.voucher_id} value={reward.voucher_id} disabled={totalPence < reward.minimum_order_pence}>{reward.reward_name}{reward.minimum_order_pence > 0 ? ` · min ${money.format(reward.minimum_order_pence / 100)}` : ''}</option>)}
      </select>
    </label>}
    {selectedReward && <div className="checkout-wallet-success"><span>✓ {selectedReward.reward_name}{rewardAppliedPence > 0 ? ` · about ${money.format(rewardAppliedPence / 100)} off` : ' · validated when the order is created'}</span><button type="button" onClick={() => setSelectedRewardId('')} disabled={disabled}>Remove</button></div>}

    <label htmlFor="gift-card-code">Gift card code</label>
    <div className="checkout-wallet-row">
      <input id="gift-card-code" value={giftCardCode} onChange={(event) => { setGiftCardCode(event.target.value.toUpperCase()); setGiftCard(null); setGiftCardError('') }} placeholder="OF-…" disabled={disabled || giftCardBusy} />
      <button type="button" onClick={() => void applyGiftCard()} disabled={disabled || giftCardBusy || !giftCardCode.trim()}>{giftCardBusy ? 'Checking…' : 'Apply'}</button>
    </div>
    {giftCard && <div className="checkout-wallet-success"><span>✓ Card ending {giftCard.code_suffix} · {money.format((giftCard.available_pence || 0) / 100)} available</span><button type="button" onClick={() => { setGiftCard(null); setGiftCardCode('') }} disabled={disabled}>Remove</button></div>}
    {giftCardError && <p className="checkout-wallet-error">{giftCardError}</p>}

    {signedIn ? <label className="checkout-credit-toggle"><input type="checkbox" checked={useCredit} onChange={(event) => setUseCredit(event.target.checked)} disabled={disabled || creditBalance <= 0} /><span><strong>Use store credit</strong><small>{creditBalance > 0 ? `${money.format(creditBalance / 100)} available` : 'No store credit available for this restaurant'}</small></span></label> : <p className="checkout-wallet-signin">Sign in or create your account to use rewards and store credit.</p>}

    {(rewardAppliedPence > 0 || giftCardAppliedPence > 0 || creditAppliedPence > 0) && <div className="checkout-wallet-applied">
      {rewardAppliedPence > 0 && <div><span>Reward</span><strong>-{money.format(rewardAppliedPence / 100)}</strong></div>}
      {giftCardAppliedPence > 0 && <div><span>Gift card</span><strong>-{money.format(giftCardAppliedPence / 100)}</strong></div>}
      {creditAppliedPence > 0 && <div><span>Store credit</span><strong>-{money.format(creditAppliedPence / 100)}</strong></div>}
    </div>}
  </section>
}
