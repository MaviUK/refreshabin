import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './StampCards.css'

type Summary={restaurants_using_stamps:number;campaign_count:number;active_campaigns:number;active_collectors:number;stamps_issued:number;cards_completed:number;qr_claims:number;manual_adjustments:number;fraud_alerts:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;campaigns:number;active_campaigns:number;collectors:number;stamps_issued:number;completions:number;qr_claims:number;manual_adjustments:number}
type FraudSignal={restaurant_name:string;staff_user_id:string|null;activity_date:string;adjustment_count:number}
type Activity={event_id:string;restaurant_name:string;program_name:string;event_type:string;stamps_delta:number;customer_user_id:string;created_at:string}
type Dashboard={summary:Summary;restaurants:RestaurantRow[];fraud_signals:FraudSignal[];recent_activity:Activity[]}

const dateTime=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})
const label=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase())
const fallbackSummary:Summary={restaurants_using_stamps:0,campaign_count:0,active_campaigns:0,active_collectors:0,stamps_issued:0,cards_completed:0,qr_claims:0,manual_adjustments:0,fraud_alerts:0}

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

  const summary=dashboard?.summary??fallbackSummary
  const completionRate=summary.stamps_issued>0?(summary.cards_completed/summary.stamps_issued)*100:0
  const qrShare=summary.stamps_issued>0?(summary.qr_claims/summary.stamps_issued)*100:0
  const activeCampaignRate=summary.campaign_count>0?(summary.active_campaigns/summary.campaign_count)*100:0

  return <section className="admin-page stamp-page">
    <header className="page-heading">
      <div><span className="admin-kicker">Loyalty intelligence</span><h1>Stamp cards</h1><p>Monitor platform adoption, engagement, QR activity and manual-adjustment risk.</p></div>
      <button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}>↻ Refresh</button>
    </header>

    {error&&<div className="admin-alert error" role="alert">{error}</div>}

    <section className="stamp-metric-grid" aria-label="Stamp card overview">
      <Metric label="Restaurants" value={loading?'—':String(summary.restaurants_using_stamps)} detail="Using stamp programmes" tone="blue"/>
      <Metric label="Active campaigns" value={loading?'—':String(summary.active_campaigns)} detail={`${summary.campaign_count} total campaigns`} tone="green"/>
      <Metric label="Active collectors" value={loading?'—':String(summary.active_collectors)} detail="Customers collecting stamps" tone="pink"/>
      <Metric label="Stamps issued" value={loading?'—':String(summary.stamps_issued)} detail={`${summary.qr_claims} via QR claims`} tone="blue"/>
      <Metric label="Cards completed" value={loading?'—':String(summary.cards_completed)} detail={`${completionRate.toFixed(1)}% of stamps`} tone="green"/>
      <Metric label="Fraud alerts" value={loading?'—':String(summary.fraud_alerts)} detail={`${summary.manual_adjustments} manual adjustments`} tone={summary.fraud_alerts>0?'red':'amber'}/>
    </section>

    <section className="stamp-insight-strip" aria-label="Stamp card health indicators">
      <Insight label="Campaign activation" value={`${activeCampaignRate.toFixed(0)}%`} detail={`${summary.active_campaigns} of ${summary.campaign_count} campaigns live`} />
      <Insight label="QR contribution" value={`${qrShare.toFixed(0)}%`} detail={`${summary.qr_claims} QR claims across issued stamps`} />
      <Insight label="Manual adjustment rate" value={summary.stamps_issued>0?`${((summary.manual_adjustments/summary.stamps_issued)*100).toFixed(1)}%`:'0%'} detail={`${summary.manual_adjustments} manual changes recorded`} />
    </section>

    {dashboard?.fraud_signals.length?<section className="admin-panel stamp-alert-panel">
      <div className="panel-heading"><div><h2>Manual-adjustment alerts</h2><p>Staff activity exceeding ten manual changes in one day.</p></div><span className="stamp-alert-count">{dashboard.fraud_signals.length} flagged</span></div>
      <div className="stamp-alert-list">{dashboard.fraud_signals.map((row,index)=><article key={`${row.restaurant_name}-${row.staff_user_id}-${row.activity_date}-${index}`}><span className="stamp-risk-icon">!</span><div><strong>{row.restaurant_name}</strong><small>{row.staff_user_id?`Staff ${row.staff_user_id.slice(0,8)}…`:'Unknown staff account'} · {new Date(row.activity_date).toLocaleDateString('en-GB')}</small></div><strong>{row.adjustment_count} adjustments</strong></article>)}</div>
    </section>:null}

    <section className="admin-panel stamp-performance-panel">
      <div className="panel-heading stamp-panel-heading"><div><h2>Restaurant performance</h2><p>{restaurants.length} restaurant{restaurants.length===1?'':'s'} represented in stamp programmes.</p></div><label className="stamp-search"><span>⌕</span><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search restaurant" aria-label="Search restaurants"/></label></div>
      {loading?<div className="panel-empty"><strong>Loading performance…</strong><span>Preparing restaurant stamp analytics.</span></div>:restaurants.length===0?<div className="panel-empty"><strong>{search?'No matching restaurants':'No stamp programmes yet'}</strong><span>{search?'Try another restaurant name.':'Restaurant performance will appear here once stamp programmes are active.'}</span></div>:<div className="stamp-table-wrap"><table className="stamp-table"><thead><tr><th>Restaurant</th><th>Campaigns</th><th>Collectors</th><th>Stamps</th><th>Completed</th><th>QR claims</th><th>Manual</th></tr></thead><tbody>{restaurants.map((row)=><tr key={row.restaurant_id}><td><div className="stamp-restaurant-cell"><span>{row.restaurant_name.slice(0,1).toUpperCase()}</span><div><strong>{row.restaurant_name}</strong><small>{row.active_campaigns} active campaign{row.active_campaigns===1?'':'s'}</small></div></div></td><td><strong>{row.campaigns}</strong></td><td>{row.collectors}</td><td>{row.stamps_issued}</td><td>{row.completions}</td><td>{row.qr_claims}</td><td><span className={row.manual_adjustments>10?'stamp-manual-badge risk':'stamp-manual-badge'}>{row.manual_adjustments}</span></td></tr>)}</tbody></table></div>}
    </section>

    <section className="admin-panel stamp-activity-panel">
      <div className="panel-heading"><div><h2>Recent stamp activity</h2><p>Latest ledger events across the platform.</p></div><span className="stamp-activity-total">{dashboard?.recent_activity.length??0} events</span></div>
      {loading?<div className="panel-empty"><strong>Loading activity…</strong></div>:!dashboard?.recent_activity.length?<div className="panel-empty"><strong>No recent stamp activity</strong><span>Ledger events will appear here as customers collect and redeem stamps.</span></div>:<div className="stamp-activity-list">{dashboard.recent_activity.map((row)=><article key={row.event_id}><span className={`stamp-event-icon ${eventTone(row.event_type)}`}>{row.stamps_delta>0?'+':'−'}</span><div className="stamp-activity-main"><div><strong>{row.restaurant_name}</strong><span className={`stamp-event-badge ${eventTone(row.event_type)}`}>{label(row.event_type)}</span></div><small>{row.program_name} · Customer {row.customer_user_id.slice(0,8)}…</small></div><div className="stamp-activity-value"><strong>{row.stamps_delta>0?'+':''}{row.stamps_delta}</strong><time>{dateTime.format(new Date(row.created_at))}</time></div></article>)}</div>}
    </section>
  </section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}
function Insight({label,value,detail}:{label:string;value:string;detail:string}){return <article><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>}
function eventTone(value:string){const normalized=value.toLowerCase();if(normalized.includes('manual')||normalized.includes('adjust'))return'risk';if(normalized.includes('complete')||normalized.includes('reward'))return'success';if(normalized.includes('qr'))return'qr';return'neutral'}
