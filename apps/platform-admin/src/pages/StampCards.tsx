import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Summary={restaurants_using_stamps:number;campaign_count:number;active_campaigns:number;active_collectors:number;stamps_issued:number;cards_completed:number;qr_claims:number;manual_adjustments:number;fraud_alerts:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;campaigns:number;active_campaigns:number;collectors:number;stamps_issued:number;completions:number;qr_claims:number;manual_adjustments:number}
type FraudSignal={restaurant_name:string;staff_user_id:string|null;activity_date:string;adjustment_count:number}
type Activity={event_id:string;restaurant_name:string;program_name:string;event_type:string;stamps_delta:number;customer_user_id:string;created_at:string}
type Dashboard={summary:Summary;restaurants:RestaurantRow[];fraud_signals:FraudSignal[];recent_activity:Activity[]}

const dateTime=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})
const label=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase())

export default function StampCards(){
  const[dashboard,setDashboard]=useState<Dashboard|null>(null)
  const[loading,setLoading]=useState(true)
  const[error,setError]=useState('')
  const[search,setSearch]=useState('')

  async function load(){
    setLoading(true);setError('')
    const{data,error:rpcError}=await supabase.rpc('get_platform_stamp_dashboard')
    if(rpcError)setError(rpcError.message);else setDashboard(data as Dashboard)
    setLoading(false)
  }

  useEffect(()=>{void load()},[])

  const restaurants=useMemo(()=>{
    const query=search.trim().toLowerCase()
    if(!query)return dashboard?.restaurants??[]
    return(dashboard?.restaurants??[]).filter((row)=>row.restaurant_name.toLowerCase().includes(query))
  },[dashboard,search])

  if(loading)return <section className="admin-page"><p>Loading stamp-card analytics…</p></section>
  const summary=dashboard?.summary??{restaurants_using_stamps:0,campaign_count:0,active_campaigns:0,active_collectors:0,stamps_issued:0,cards_completed:0,qr_claims:0,manual_adjustments:0,fraud_alerts:0}

  return <section className="admin-page">
    <header className="admin-page-header"><div><span className="admin-kicker">Loyalty intelligence</span><h1>Stamp cards</h1><p>Monitor platform adoption, engagement, QR activity and manual-adjustment risk.</p></div><button type="button" className="admin-secondary-button" onClick={()=>void load()}>Refresh</button></header>
    {error&&<div className="admin-error" role="alert">{error}</div>}

    <div className="admin-metric-grid">
      <article><span>Restaurants</span><strong>{summary.restaurants_using_stamps}</strong></article>
      <article><span>Active campaigns</span><strong>{summary.active_campaigns}</strong></article>
      <article><span>Active collectors</span><strong>{summary.active_collectors}</strong></article>
      <article><span>Stamps issued</span><strong>{summary.stamps_issued}</strong></article>
      <article><span>Cards completed</span><strong>{summary.cards_completed}</strong></article>
      <article><span>Fraud alerts</span><strong>{summary.fraud_alerts}</strong></article>
    </div>

    {dashboard?.fraud_signals.length?<section className="admin-table-card"><header><div><h2>Manual-adjustment alerts</h2><p>Staff activity exceeding ten manual changes in one day.</p></div></header><div className="admin-table-wrap"><table><thead><tr><th>Restaurant</th><th>Staff user</th><th>Date</th><th>Adjustments</th></tr></thead><tbody>{dashboard.fraud_signals.map((row,index)=><tr key={`${row.restaurant_name}-${row.staff_user_id}-${row.activity_date}-${index}`}><td><strong>{row.restaurant_name}</strong></td><td>{row.staff_user_id||'Unknown staff account'}</td><td>{new Date(row.activity_date).toLocaleDateString('en-GB')}</td><td><span className="admin-status admin-status--failed">{row.adjustment_count}</span></td></tr>)}</tbody></table></div></section>:null}

    <section className="admin-table-card">
      <header><div><h2>Restaurant performance</h2><p>{restaurants.length} restaurants</p></div><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search restaurant" /></header>
      <div className="admin-table-wrap"><table><thead><tr><th>Restaurant</th><th>Campaigns</th><th>Collectors</th><th>Stamps</th><th>Completed</th><th>QR claims</th><th>Manual</th></tr></thead><tbody>{restaurants.map((row)=><tr key={row.restaurant_id}><td><strong>{row.restaurant_name}</strong><small>{row.active_campaigns} active</small></td><td>{row.campaigns}</td><td>{row.collectors}</td><td>{row.stamps_issued}</td><td>{row.completions}</td><td>{row.qr_claims}</td><td>{row.manual_adjustments}</td></tr>)}</tbody></table></div>
    </section>

    <section className="admin-table-card">
      <header><div><h2>Recent stamp activity</h2><p>Latest 100 ledger events</p></div></header>
      <div className="admin-table-wrap"><table><thead><tr><th>Restaurant</th><th>Campaign</th><th>Event</th><th>Stamps</th><th>Customer</th><th>Time</th></tr></thead><tbody>{dashboard?.recent_activity.map((row)=><tr key={row.event_id}><td><strong>{row.restaurant_name}</strong></td><td>{row.program_name}</td><td><span className={`admin-status admin-status--${row.event_type}`}>{label(row.event_type)}</span></td><td>{row.stamps_delta>0?'+':''}{row.stamps_delta}</td><td>{row.customer_user_id.slice(0,8)}…</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}</tbody></table></div>
    </section>
  </section>
}
