import { Outlet } from 'react-router-dom'
import CustomerSiteHeader from '../components/CustomerSiteHeader'
import './CustomerAccountLayout.css'

export default function CustomerAccountLayout() {
  return (
    <div className="customer-site-account-layout">
      <CustomerSiteHeader showNotifications />
      <div className="customer-site-account-content">
        <Outlet />
      </div>
    </div>
  )
}
