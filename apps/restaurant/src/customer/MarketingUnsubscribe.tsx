import { useEffect,useState } from 'react'
import { Link,useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../marketing/MarketingWorkspace.css'

export default function MarketingUnsubscribe(){const[params]=useSearchParams();const[state,setState]=useState<'loading'|'success'|'invalid'|'error'>('loading')
 useEffect(()=>{void unsubscribe()},[])
 async function unsubscribe(){const token=params.get('token');if(!token){setState('invalid');return}const{data,error}=await supabase.rpc('unsubscribe_marketing_by_token',{p_token:token});if(error){setState('error');return}setState(data?'success':'invalid')}
 return <main className="mcrm-page"><section className="mcrm-unsubscribe"><Link to="/restaurants">ordered.food</Link><h1>{state==='loading'?'Updating preferences…':state==='success'?'You are unsubscribed':state==='invalid'?'This unsubscribe link is no longer valid':'We could not update your preference'}</h1><p>{state==='success'?'Marketing email from this restaurant has been disabled. You can review all preferences from your account at any time.':state==='invalid'?'The link may have expired or already been used. Sign in to manage your marketing preferences directly.':state==='error'?'Please use your account preferences to opt out.':'Please wait.'}</p>{state!=='loading'&&<div className="mcrm-actions" style={{justifyContent:'center'}}><Link className="mcrm-button" to="/account/marketing-preferences">Manage preferences</Link><Link className="mcrm-button secondary" to="/restaurants">Browse restaurants</Link></div>}</section></main>}
