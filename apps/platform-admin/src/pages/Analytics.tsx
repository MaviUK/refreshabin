import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../types'
import './Analytics.css'

type Daily={day:string;paid_orders:number;failed_payments:number;gross_pence:number;refunded_pence:number}
type RestaurantPerf={id:string;name:string;order_count:number;gross_pence:number;avg_accept_minutes:number|null;avg_fulfilment_minutes:number|null;cancelled_orders:number}
type Analytics={range:{days:number;from:string;to:string};summary:{paid_orders:number;failed_payments:number;gross_pence:number;refunded_pence:number;average_order_value_pence:number;payment_failure_rate:number;online_restaurants:number;offline_active_restaurants:number};daily:Daily[];top_restaurants:RestaurantPerf[];slow_restaurants:RestaurantPerf[];alerts:{orders_waiting_over_10_minutes:number;failed_payments_last_24h:number;failed_print_jobs:number;overdue_support_cases:number;pending_restaurant_applications:number;failed_payouts:number}}

export default function Analytics(){
 const [days,setDays]=useState(30),[data,setData]=useState<Analytics|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
 const load=useCallback(async()=>{setLoading(true);setError('');const {data:r,error:e}=await supabase.rpc('get_platform_analytics',{p_days:days});if(e)setError(e.message);else setData(r as Analytics);setLoading(false)},[days])
 useEffect(()=>{void load()},[load])
 return <div className="admin-page analytics-page"><header className="page-heading"><div><span className="admin-kicker">Platform intelligence</span><h1>Analytics & monitoring</h1><p>Track demand, revenue, payment health and operational risk across ordered.food.</p></div><div className="analytics-actions"><select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select><button className="secondary-button" onClick={()=>void load()} disabled={loading}>↻ Refresh</button></div></header>
 {error&&<div className="admin-alert error" role="alert">{error}</div>}
 <section className="metric-grid"><Metric label="Paid orders" value={loading?'—':String(data?.summary.paid_orders??0)} detail={`${days}-day period`} tone="blue"/><Metric label="Gross order value" value={loading?'—':formatMoney(data?.summary.gross_pence)} detail={`AOV ${formatMoney(data?.summary.average_order_value_pence)}`} tone="green"/><Metric label="Payment failure rate" value={loading?'—':`${data?.summary.payment_failure_rate??0}%`} detail={`${data?.summary.failed_payments??0} failed attempts`} tone="red"/><Metric label="Restaurants online" value={loading?'—':String(data?.summary.online_restaurants??0)} detail={`${data?.summary.offline_active_restaurants??0} active but offline`} tone="amber"/></section>
 <SalesTrend daily={data?.daily??[]} range={data?.range} loading={loading}/>
 <div className="overview-grid analytics-grid"><section className="admin-panel"><div className="panel-heading"><div><h2>Operational alerts</h2><p>Issues requiring attention now.</p></div></div><Alert to="/orders?status=placed" label="Orders waiting over 10 minutes" value={data?.alerts.orders_waiting_over_10_minutes??0}/><Alert to="/payments?status=failed" label="Failed payments in 24 hours" value={data?.alerts.failed_payments_last_24h??0}/><Alert to="/order-recovery" label="Failed print jobs" value={data?.alerts.failed_print_jobs??0}/><Alert to="/support-sla?queue=overdue" label="Overdue support cases" value={data?.alerts.overdue_support_cases??0}/><Alert to="/restaurants?status=pending_approval" label="Applications pending" value={data?.alerts.pending_restaurant_applications??0}/><Alert to="/payouts?status=failed" label="Failed payouts" value={data?.alerts.failed_payouts??0}/></section>
 <section className="admin-panel"><div className="panel-heading"><div><h2>Top restaurants</h2><p>Ranked by gross order value.</p></div></div>{!loading&&!data?.top_restaurants.length?<div className="panel-empty compact"><strong>No sales yet</strong><span>Restaurant rankings will appear here.</span></div>:<div className="analytics-table">{data?.top_restaurants.map((r,i)=><article key={r.id}><span>{i+1}</span><div><strong>{r.name}</strong><small>{r.order_count} orders</small></div><strong>{formatMoney(r.gross_pence)}</strong></article>)}</div>}</section></div>
 <section className="admin-panel"><div className="panel-heading"><div><h2>Restaurant response performance</h2><p>Highest average acceptance times appear first.</p></div></div><div className="financial-table-scroll"><table><thead><tr><th>Restaurant</th><th>Orders</th><th>Average accept</th><th>Average fulfilment</th><th>Cancelled/rejected</th><th>Gross</th></tr></thead><tbody>{data?.slow_restaurants.map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.order_count}</td><td>{minutes(r.avg_accept_minutes)}</td><td>{minutes(r.avg_fulfilment_minutes)}</td><td>{r.cancelled_orders}</td><td>{formatMoney(r.gross_pence)}</td></tr>)}</tbody></table></div></section></div>
}

function SalesTrend({daily,range,loading}:{daily:Daily[];range:Analytics['range']|undefined;loading:boolean}){
 const total=useMemo(()=>daily.reduce((sum,row)=>sum+row.gross_pence,0),[daily])
 const peak=useMemo(()=>daily.reduce<Daily|null>((best,row)=>!best||row.gross_pence>best.gross_pence?row:best,null),[daily])
 const activeDays=useMemo(()=>daily.filter(row=>row.gross_pence>0).length,[daily])
 const average=daily.length?Math.round(total/daily.length):0
 if(loading)return <section className="admin-panel analytics-trend"><div className="panel-heading"><div><h2>Daily gross sales</h2><p>Loading sales trend…</p></div></div><div className="sales-chart-loading"/></section>
 if(!daily.length)return <section className="admin-panel analytics-trend"><div className="panel-heading"><div><h2>Daily gross sales</h2><p>No analytics data is available for this period.</p></div></div><div className="sales-chart-empty">Sales data will appear once paid orders are recorded.</div></section>

 const width=1000,height=280,left=70,right=18,top=18,bottom=46
 const plotWidth=width-left-right,plotHeight=height-top-bottom,baseY=top+plotHeight
 const maxGross=Math.max(...daily.map(row=>row.gross_pence),1)
 const x=(index:number)=>daily.length===1?left+plotWidth/2:left+(index/(daily.length-1))*plotWidth
 const y=(value:number)=>baseY-(value/maxGross)*plotHeight
 const points=daily.map((row,index)=>({row,x:x(index),y:y(row.gross_pence)}))
 const firstPoint=points[0]
 const lastPoint=points[points.length-1]
 if(!firstPoint||!lastPoint)return null
 const line=points.map((point,index)=>`${index===0?'M':'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
 const area=`${line} L ${lastPoint.x.toFixed(2)} ${baseY} L ${firstPoint.x.toFixed(2)} ${baseY} Z`
 const labelIndexes=Array.from(new Set([0,Math.round((daily.length-1)*.25),Math.round((daily.length-1)*.5),Math.round((daily.length-1)*.75),daily.length-1]))
 const gridLevels=[1,.75,.5,.25,0]

 return <section className="admin-panel analytics-trend"><div className="panel-heading"><div><h2>Daily gross sales</h2><p>{range?.from&&range?.to?`${formatShortDate(range.from)} – ${formatShortDate(range.to)}`:'Selected reporting period'}</p></div><div className="analytics-trend-summary"><span><small>Daily average</small><strong>{formatMoney(average)}</strong></span><span><small>Peak day</small><strong>{peak?`${formatMoney(peak.gross_pence)} · ${formatShortDate(peak.day)}`:'—'}</strong></span></div></div><div className="sales-chart-shell"><svg className="sales-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily gross sales trend"><defs><linearGradient id="salesAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d94b82" stopOpacity="0.28"/><stop offset="100%" stopColor="#d94b82" stopOpacity="0.025"/></linearGradient></defs>{gridLevels.map(level=>{const gy=baseY-level*plotHeight;return <g key={level}><line className={level===0?'sales-chart-baseline':'sales-chart-grid'} x1={left} x2={width-right} y1={gy} y2={gy}/><text className="sales-chart-axis-label" x={left-12} y={gy+4} textAnchor="end">{compactMoney(Math.round(maxGross*level))}</text></g>})}<path className="sales-chart-area" d={area}/><path className="sales-chart-line" d={line}/>{points.map(({row,x:px,y:py})=><circle className="sales-chart-dot" key={row.day} cx={px} cy={py} r="4"><title>{`${formatShortDate(row.day)} · ${formatMoney(row.gross_pence)} · ${row.paid_orders} paid order${row.paid_orders===1?'':'s'}`}</title></circle>)}{labelIndexes.map(index=>{const point=points[index];if(!point)return null;const anchor=index===0?'start':index===daily.length-1?'end':'middle';return <text className="sales-chart-date-label" key={point.row.day} x={point.x} y={height-10} textAnchor={anchor}>{formatAxisDate(point.row.day)}</text>})}</svg></div><div className="sales-chart-caption"><span><strong>{activeDays}</strong> of {daily.length} days recorded paid sales</span><span>Hover chart points for daily revenue and order count.</span></div></section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}
function Alert({to,label,value}:{to:string;label:string;value:number}){return <Link className={`attention-row ${value>0?'has-alert':''}`} to={to}><span className="attention-icon red">!</span><span><strong>{value} {label.toLowerCase()}</strong><small>{value>0?'Open the related control centre.':'No current issues.'}</small></span><span>›</span></Link>}
function minutes(value:number|null){return value===null?'No data':`${value} min`}
function formatShortDate(value:string){return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
function formatAxisDate(value:string){return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
function compactMoney(pence:number){const pounds=pence/100;if(pounds>=1000)return `£${(pounds/1000).toFixed(pounds>=10000?0:1)}k`;if(pounds>=100)return `£${Math.round(pounds)}`;if(pounds>=10)return `£${pounds.toFixed(0)}`;return `£${pounds.toFixed(pounds===0?0:2)}`}
