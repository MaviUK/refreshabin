import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, hasAdminPermission } from '../types'
import { useAdmin } from '../components/AdminLayout'
import './Vip.css'

type Summary={restaurants_using_vip:number;total_vip_customers:number;restaurant_adoption_percent:number;vip_revenue_90d_pence:number;average_customer_value_pence:number;open_fraud_flags:number;benefit_events_90d:number;vip_discount_cost_90d_pence?:number;roi_percent?:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;is_enabled:boolean;disabled_by_platform:boolean;vip_customers:number;vip_revenue_90d_pence:number;avg_spend_pence:number;upgrades_30d:number;downgrades_30d:number;open_fraud_flags:number;vip_discount_cost_90d_pence?:number;roi_percent?:number}
type TierDistribution={tier_name:string;customers:number;revenue_pence:number}
type FraudFlag={id:string;restaurant_id:string;restaurant_name:string;customer_user_id:string|null;flag_type:string;severity:string;status:string;details:Record<string,unknown>;created_at:string;reviewed_at:string|null;review_note:string|null}
type Dashboard={summary:Summary;restaurants:RestaurantRow[];tier_distribution:TierDistribution[];fraud_flags:FraudFlag[]}
const text=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,l=>l.toUpperCase())
const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})

export default function Vip(){
 const{admin}=useAdmin();const[dash,setDash]=useState<Dashboard|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[busy,setBusy]=useState('');const canManage=hasAdminPermission(admin,'restaurants:manage')
 async function load(){setLoading(true);setError('');const{data,error:rpcError}=await supabase.rpc('get_platform_vip_dashboard');if(rpcError)setError(rpcError.message);else setDash(data as Dashboard);setLoading(false)}
 useEffect(()=>{void load()},[])
 async function toggleProgramme(row:RestaurantRow){const disabling=!row.disabled_by_platform;const reason=disabling?window.prompt('Reason for disabling this VIP programme?','Suspected VIP programme abuse'):null;if(disabling&&!reason)return;setBusy(row.restaurant_id);const{error:rpcError}=await supabase.rpc('platform_set_vip_program_disabled',{p_restaurant_id:row.restaurant_id,p_disabled:disabling,p_reason:reason});if(rpcError)setError(rpcError.message);else await load();setBusy('')}
 async function review(flag:FraudFlag,status:'reviewed'|'dismissed'|'actioned'){const note=window.prompt(`Optional note for ${status} decision:`,'');setBusy(flag.id);const{error:rpcError}=await supabase.rpc('platform_review_vip_fraud_flag',{p_flag_id:flag.id,p_status:status,p_note:note||''});if(rpcError)setError(rpcError.message);else await load();setBusy('')}
 const maxTierCustomers=useMemo(()=>Math.max(...(dash?.tier_distribution.map(row=>row.customers)??[0]),1),[dash])
 if(loading)return <section className="admin-page"><div className="vip-loading">Loading VIP intelligence…</div></section>
 const s=dash?.summary||{restaurants_using_vip:0,total_vip_customers:0,restaurant_adoption_percent:0,vip_revenue_90d_pence:0,average_customer_value_pence:0,open_fraud_flags:0,benefit_events_90d:0}
 return <section className="admin-page vip-page">
  <header className="page-heading"><div><span className="admin-kicker">Retention & membership</span><h1>VIP programmes</h1><p>Platform adoption, tier economics, customer value, engagement and abuse monitoring.</p></div><button type="button" className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></header>
  {error&&<div className="admin-alert error" role="alert">{error}</div>}

  <section className="vip-metrics">
   <Metric label="Restaurants using VIP" value={String(s.restaurants_using_vip)} detail={`${Number(s.restaurant_adoption_percent).toFixed(1)}% adoption`} tone="blue"/>
   <Metric label="VIP customers" value={String(s.total_vip_customers)} detail="Current tier members" tone="pink"/>
   <Metric label="VIP revenue · 90d" value={formatMoney(s.vip_revenue_90d_pence)} detail="Orders placed with a VIP tier" tone="green"/>
   <Metric label="Average customer value" value={formatMoney(s.average_customer_value_pence)} detail="90-day VIP customer value" tone="green"/>
   <Metric label="Benefit events · 90d" value={String(s.benefit_events_90d)} detail="Discounts, bonuses and rewards" tone="blue"/>
   <Metric label="VIP benefit cost · 90d" value={formatMoney(s.vip_discount_cost_90d_pence||0)} detail="Automatic checkout discounts" tone="amber"/>
   <Metric label="VIP ROI" value={`${Number(s.roi_percent||0).toFixed(1)}%`} detail="Revenue versus benefit cost" tone={Number(s.roi_percent||0)>=0?'green':'red'}/>
   <Metric label="Open fraud flags" value={String(s.open_fraud_flags)} detail="Needs review" tone={s.open_fraud_flags>0?'red':'blue'}/>
  </section>

  <section className="admin-panel vip-panel"><div className="panel-heading"><div><span className="admin-kicker">Restaurant comparison</span><h2>VIP programme performance</h2><p>Sorted by 90-day VIP revenue.</p></div><span className="vip-count-badge">{dash?.restaurants.length??0} programmes</span></div>
   {dash?.restaurants.length?<div className="vip-programmes">{dash.restaurants.map(row=>{const roi=Number(row.roi_percent||0);const movement=row.upgrades_30d-row.downgrades_30d;return <article key={row.restaurant_id} className="vip-programme-card"><div className="vip-programme-head"><div><strong>{row.restaurant_name}</strong><span className={`vip-status ${row.disabled_by_platform?'disabled':row.is_enabled?'enabled':'paused'}`}>{row.disabled_by_platform?'Platform disabled':row.is_enabled?'Enabled':'Restaurant paused'}</span></div><div className="vip-revenue"><small>90-day revenue</small><strong>{formatMoney(row.vip_revenue_90d_pence)}</strong></div></div><div className="vip-performance-grid"><span><small>VIP customers</small><strong>{row.vip_customers}</strong></span><span><small>Avg spend</small><strong>{formatMoney(row.avg_spend_pence)}</strong></span><span><small>ROI</small><strong className={roi<0?'negative':''}>{roi.toFixed(1)}%</strong></span><span><small>30-day movement</small><strong className={movement<0?'negative':''}>{movement>0?'+':''}{movement}</strong></span></div><div className="vip-movement"><span><b>{row.upgrades_30d}</b> upgrades</span><span><b>{row.downgrades_30d}</b> downgrades</span><span className={row.open_fraud_flags>0?'risk':''}><b>{row.open_fraud_flags}</b> fraud flags</span></div><div className="vip-programme-foot"><span>{row.vip_customers>0?'Active membership data available':'No current VIP members'}</span>{canManage?<button type="button" className={row.disabled_by_platform?'secondary-button vip-action':'danger-button ghost vip-action'} disabled={busy===row.restaurant_id} onClick={()=>void toggleProgramme(row)}>{row.disabled_by_platform?'Re-enable':'Disable'}</button>:<small>View only</small>}</div></article>})}</div>:<div className="panel-empty"><strong>No VIP programmes configured</strong><span>Restaurant VIP programmes will appear here once enabled.</span></div>}
  </section>

  <section className="admin-panel vip-panel"><div className="panel-heading"><div><span className="admin-kicker">Tier distribution</span><h2>Membership mix</h2><p>Customer concentration and 90-day revenue by VIP tier.</p></div><span className="vip-count-badge">{s.total_vip_customers} members</span></div>
   {dash?.tier_distribution.length?<div className="vip-tier-list">{dash.tier_distribution.map((row,index)=>{const share=s.total_vip_customers>0?Math.round(row.customers/s.total_vip_customers*100):0;return <article key={`${row.tier_name}-${index}`}><div className="vip-tier-rank">{index+1}</div><div className="vip-tier-copy"><div><strong>{row.tier_name}</strong><span>{share}% of VIP members</span></div><div className="vip-tier-track"><i style={{width:`${Math.max(5,(row.customers/maxTierCustomers)*100)}%`}}/></div></div><div className="vip-tier-stat"><small>Customers</small><strong>{row.customers}</strong></div><div className="vip-tier-stat"><small>90-day revenue</small><strong>{formatMoney(row.revenue_pence)}</strong></div></article>})}</div>:<div className="panel-empty"><strong>No membership distribution yet</strong><span>Tier distribution will appear once customers enter VIP tiers.</span></div>}
  </section>

  <section className="admin-panel vip-panel"><div className="panel-heading"><div><span className="admin-kicker">Fraud monitoring</span><h2>VIP risk signals</h2><p>Tier changes remain server-controlled; these signals highlight abnormal activity.</p></div><span className={`vip-risk-count ${s.open_fraud_flags>0?'active':''}`}>{s.open_fraud_flags} open</span></div>
   {dash?.fraud_flags.length?<div className="vip-risk-list">{dash.fraud_flags.map(flag=><article key={flag.id}><div className={`vip-risk-severity ${flag.severity}`}/><div className="vip-risk-copy"><strong>{flag.restaurant_name}</strong><span>{text(flag.flag_type)}</span><small>{date.format(new Date(flag.created_at))}</small></div><div className="vip-risk-meta"><span className={`vip-status risk-${flag.severity}`}>{text(flag.severity)}</span><span className="vip-status neutral">{text(flag.status)}</span></div><div className="vip-risk-actions">{flag.status==='open'&&canManage?<><button type="button" className="secondary-button vip-action" disabled={busy===flag.id} onClick={()=>void review(flag,'reviewed')}>Review</button><button type="button" className="secondary-button vip-action" disabled={busy===flag.id} onClick={()=>void review(flag,'dismissed')}>Dismiss</button><button type="button" className="secondary-button vip-action" disabled={busy===flag.id} onClick={()=>void review(flag,'actioned')}>Actioned</button></>:<small>{flag.status==='open'?'View only':'Reviewed'}</small>}</div></article>)}</div>:<div className="panel-empty"><strong>No VIP risk signals</strong><span>There are currently no VIP fraud signals requiring review.</span></div>}
  </section>
 </section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}
