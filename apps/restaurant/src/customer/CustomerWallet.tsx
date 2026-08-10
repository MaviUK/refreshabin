import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerWallet.css'

type CreditAccount = {
  restaurant_id: string
  restaurant_name: string
  restaurant_slug: string
  balance_pence: number
  updated_at: string
}

type GiftCard = {
  id: string
  restaurant_id: string
  restaurant_name: string
  restaurant_slug: string
  code_suffix: string
  original_value_pence: number
  remaining_value_pence: number
  recipient_name: string | null
  message: string | null
  expires_at: string | null
  created_at: string
}

type WalletTransaction = {
  id: string
  restaurant_name: string
  amount_pence: number
  entry_type: string
  note: string | null
  created_at: string
}

type WalletSummary = {
  total_credit_pence: number
  credit_accounts: CreditAccount[]
  gift_cards: GiftCard[]
  transactions: WalletTransaction[]
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function CustomerWallet() {
  const navigate = useNavigate()
  const [wallet, setWallet] = useState<WalletSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadWallet() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) {
        navigate('/account/login', { replace: true, state: { from: '/account/wallet' } })
        return
      }

      const { data, error: walletError } = await supabase.rpc('get_customer_wallet_summary')
      if (!active) return
      if (walletError) setError(walletError.message)
      else setWallet(data as WalletSummary)
      setLoading(false)
    }

    void loadWallet()
    return () => { active = false }
  }, [navigate])

  if (loading) return <main className="customer-wallet-state">Loading your wallet…</main>

  const summary = wallet || { total_credit_pence: 0, credit_accounts: [], gift_cards: [], transactions: [] }

  return (
    <main className="customer-wallet-page">
      <header className="customer-wallet-header">
        <Link to="/account">← Back to account</Link>
        <strong>Wallet</strong>
        <Link to="/restaurants">Find food</Link>
      </header>

      <section className="customer-wallet-hero">
        <span>Available store credit</span>
        <h1>{money.format(summary.total_credit_pence / 100)}</h1>
        <p>Credit and gift cards are linked to the restaurant that issued them.</p>
      </section>

      {error && <p className="customer-wallet-error" role="alert">{error}</p>}

      <section className="customer-wallet-section">
        <div className="customer-wallet-heading"><div><span>Balances</span><h2>Store credit</h2></div></div>
        {summary.credit_accounts.length ? (
          <div className="customer-wallet-list">
            {summary.credit_accounts.map((account) => (
              <article key={account.restaurant_id}>
                <div><h3>{account.restaurant_name}</h3><small>Updated {date.format(new Date(account.updated_at))}</small></div>
                <div className="customer-wallet-value"><strong>{money.format(account.balance_pence / 100)}</strong><Link to={`/r/${account.restaurant_slug}`}>Order</Link></div>
              </article>
            ))}
          </div>
        ) : <div className="customer-wallet-empty">You do not currently have any store credit.</div>}
      </section>

      <section className="customer-wallet-section">
        <div className="customer-wallet-heading"><div><span>Received</span><h2>Gift cards</h2></div></div>
        {summary.gift_cards.length ? (
          <div className="customer-wallet-cards">
            {summary.gift_cards.map((card) => (
              <article key={card.id}>
                <div className="customer-wallet-card-top"><span>{card.restaurant_name}</span><strong>{money.format(card.remaining_value_pence / 100)}</strong></div>
                <h3>Gift card ending {card.code_suffix}</h3>
                {card.message && <p>“{card.message}”</p>}
                <div className="customer-wallet-card-meta"><span>Original value {money.format(card.original_value_pence / 100)}</span><span>{card.expires_at ? `Expires ${date.format(new Date(card.expires_at))}` : 'No expiry date'}</span></div>
                <Link to={`/r/${card.restaurant_slug}`}>Use this gift card</Link>
              </article>
            ))}
          </div>
        ) : <div className="customer-wallet-empty">No active gift cards are linked to your email address.</div>}
      </section>

      <section className="customer-wallet-section">
        <div className="customer-wallet-heading"><div><span>Activity</span><h2>Credit history</h2></div></div>
        {summary.transactions.length ? (
          <div className="customer-wallet-transactions">
            {summary.transactions.map((transaction) => (
              <article key={transaction.id}>
                <div><strong>{transaction.restaurant_name}</strong><span>{transaction.note || label(transaction.entry_type)}</span><small>{date.format(new Date(transaction.created_at))}</small></div>
                <strong className={transaction.amount_pence >= 0 ? 'positive' : 'negative'}>{transaction.amount_pence >= 0 ? '+' : '−'}{money.format(Math.abs(transaction.amount_pence) / 100)}</strong>
              </article>
            ))}
          </div>
        ) : <div className="customer-wallet-empty">Your store-credit activity will appear here.</div>}
      </section>
    </main>
  )
}
