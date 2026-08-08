import { NavLink } from 'react-router-dom'
import './MarketingWorkspace.css'

const links=[['/marketing','Overview'],['/marketing/crm','CRM'],['/marketing/customers','Customers'],['/marketing/segments','Segments'],['/marketing/campaigns','Campaigns'],['/marketing/automations','Automations'],['/marketing/reports','Reports'],['/marketing/analytics','Analytics']]
export default function MarketingWorkspaceNav(){return <nav className="mcrm-nav" aria-label="Marketing"><div className="mcrm-nav-inner">{links.map(([to,label])=><NavLink key={to} to={to} end={to==='/marketing'} className={({isActive})=>isActive?'active':''}>{label}</NavLink>)}</div></nav>}
