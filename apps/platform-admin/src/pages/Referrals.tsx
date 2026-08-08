import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, hasAdminPermission } from '../types'
import { useAdmin } from '../components/AdminLayout'
import './Referrals.css'

type Summary={restaurant_adoption:number;total_programmes:number;referrals:number;qualified:number;rewarded:number;conversion_rate:number;referred_revenue_pence:number;reward_cost_pence:number;open_fraud_flags:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;enabled:boolean;disabled_by_platform:boolean;referrals:number;qualified:number;rewarded:number;revenue_pence:number}
type FraudFlag={id:string;restaurant_id:string;restaurant_name:string;referral_id:string|null;flag_type:string;severity:string;status:string;details:Record<string,unknown>;created_at:string}
type Dashboard={summary:Summary;restaurants:RestaurantRow[];fraud_flags:FraudFlag[]}
const text=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,l=>l.toUpperCase())
const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})

export default function Referrals(){
 const{admin}=useAdmin();const[dash,setDash]=useState<Dashboard|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[busy,setBusy]=useState('');const canDisable=hasAdminPermission(admin,'restaurants:manage');const canReview=hasAdminPermission(admin,'moderation:manage')
 async function load(){setLoading(true);setError('');const{data,error:rpcError}=await supabase.rpc('get_platform_referral_dashboard');if(rpcError)setError(rpcError.message);else setDash(data as Dashboard);setLoading(false)}
 useEffect(()=>{void load()},[])
 async function toggle(row:RestaurantRow){const reason=row.disabled_by_platform?null:window.prompt('Reason for disabling this referral programme?','Suspicious or abusive referral activity');if(!row.disabled_by_platform&&!reason)return;setBusy(row.restaurant_id);const{error:rpcError}=await supabase.rpc('platform_set_referral_program_disabled',{p_restaurant_id:row.restaurant_id,p_disabled:!row.disabled_by_platform,p_reason:reason});if(rpcError)setError(rpcError.message);else await load();setBusy('')}
 async function review(flag:FraudFlag,status:'confirmed'|'dismissed'){setBusy(flag.id);const note=window.prompt(`Optional note for ${status} decision:`,'');const{error:rpcError}=await supabase.rpc('platform_review_referral_fraud_flag',{p_flag_id:flag.id,p_status:status,p_note:note||null});if(rpcError)setError(rpcError.message);else await load();setBusy('')}
 if(loading)return <section className="admin-page"><div className="referral-loading">Loading referral intelligence…</div></section>
 const s=dash?.summary||{restaurant_adoption:0,total_programmes:0,referrals:0,qualified:0,rewarded:0,conversion_rate:0,referred_revenue_pence:0,reward_cost_pence:0,open_fraud_flags:0}
 return <section className="admin-page referrals-page">
  <header className="page-heading"><div><span className="admin-kicker">Growth & trust</span><h1>Referrals</h1><p>Platform-wide referral adoption, economics and fraud monitoring.</p></div><button type="button" className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></header>
  {error&&<div className="admin-alert error" role="alert">{error}</div>}
  <section className="referral-metrics">
   <Metric label="Restaurants live" value={String(s.restaurant_adoption)} detail={`${s.total_programmes} configured`} tone="blue"/>
   <Metric label="Referrals" value={String(s.referrals)} detail={`${s.qualified} qualified`} tone="pink"/>
   <Metric label="Conversion" value={`${Number(s.conversion_rate).toFixed(1)}%`} detail={`${s.rewarded} rewarded`} tone="green"/>
   <Metric label="Referred revenue" value={formatMoney(s.referred_revenue_pence)} detail="Completed referred orders" tone="green"/>
   <Metric label="Reward cost" value={formatMoney(s.reward_cost_pence)} detail="Issued / redeemed value" tone="amber"/>
   <Metric label="Open risk flags" value={String(s.open_fraud_flags)} detail="Needs review" tone={s.open_fraud_flags>0?'red':'blue'}/>
  </section>

  <section className="admin-panel referral-panel"><div className="panel-heading"><div><span className="admin-kicker">Adoption</span><h2>Restaurant programmes</h2><p>Programme status, funnel performance and referred revenue.</p></div></div>
   {dash?.restaurants.length?<div className="referral-programmes">{dash.restaurants.map(row=><article key={row.restaurant_id} className="referral-programme-card"><div className="referral-programme-head"><div><strong>{row.restaurant_name}</strong><span className={`referral-status ${row.disabled_by_platform?'disabled':row.enabled?'enabled':'paused'}`}>{row.disabled_by_platform?'Platform disabled':row.enabled?'Enabled':'Paused'}</span></div><strong>{formatMoney(row.revenue_pence)}</strong></div><div className="referral-funnel"><span><small>Referrals</small><strong>{row.referrals}</strong></span><span><small>Qualified</small><strong>{row.qualified}</strong></span><span><small>Rewarded</small><strong>{row.rewarded}</strong></span></div><div className="referral-programme-foot"><span>{row.referrals>0?`${Math.round((row.rewarded/row.referrals)*100)}% rewarded`:'No referrals yet'}</span>{canDisable?<button type="button" className={row.disabled_by_platform?'secondary-button referral-action':'danger-button ghost referral-action'} disabled={busy===row.restaurant_id} onClick={()=>void toggle(row)}>{row.disabled_by_platform?'Re-enable':'Disable'}</button>:<small>View only</small>}</div></article>)}</div>:<div className="panel-empty"><strong>No referral programmes yet</strong><span>Restaurant referral programmes will appear here once configured.</span></div>}
  </section>

  <section className="admin-panel referral-panel"><div className="panel-heading"><div><span className="admin-kicker">Fraud monitoring</span><h2>Suspicious referral activity</h2><p>No raw card data is stored or exposed.</p></div><span className={`risk-count ${s.open_fraud_flags>0?'active':''}`}>{s.open_fraud_flags} open</span></div>
   {dash?.fraud_flags.length?<div className="referral-risk-list">{dash.fraud_flags.map(flag=><article key={flag.id}><div className={`risk-severity ${flag.severity}`}/><div><strong>{flag.restaurant_name}</strong><span>{text(flag.flag_type)}</span><small>{date.format(new Date(flag.created_at))}</small></div><div className="risk-meta"><span className={`referral-status risk-${flag.severity}`}>{text(flag.severity)}</span><span className="referral-status neutral">{text(flag.status)}</span></div><div className="risk-actions">{flag.status==='open'&&canReview?<><button type="button" className="secondary-button referral-action" disabled={busy===flag.id} onClick={()=>void review(flag,'confirmed')}>Confirm</button><button type="button" className="secondary-button referral-action" disabled={busy===flag.id} onClick={()=>void review(flag,'dismissed')}>Dismiss</button></>:<small>{flag.status==='open'?'View only':'Reviewed'}</small>}</div></article>)}</div>:<div className="panel-empty"><strong>No suspicious referral activity</strong><span>There are currently no referral risk signals requiring review.</span></div>}
  </section>
 </section>
}
function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}
