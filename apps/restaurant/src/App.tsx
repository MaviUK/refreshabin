import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './auth/Login'
import Register from './auth/Register'
import ForgotPassword from './auth/ForgotPassword'
import ResetPassword from './auth/ResetPassword'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './home/Home'
import Restaurants from './discovery/Restaurants'
import Dashboard from './dashboard/Dashboard'
import Onboarding from './onboarding/Onboarding'
import MenuBuilder from './menu/MenuBuilder'
import ModifierGroups from './menu/ModifierGroups'
import OpeningHours from './opening-hours/OpeningHours'
import Branding from './branding/Branding'
import RestaurantSettings from './settings/RestaurantSettings'
import DeliveryAreas from './settings/DeliveryAreas'
import DeliveryMap from './settings/DeliveryMap'
import Storefront from './storefront/Storefront'
import Checkout from './checkout/Checkout'
import OrderStatus from './order/OrderStatus'
import Orders from './orders/Orders'
import KitchenDisplay from './kds/KitchenDisplay'
import PrinterManagement from './printers/PrinterManagement'
import PrintHistory from './printers/PrintHistory'
import CustomerLogin from './customer/CustomerLogin'
import CustomerRegister from './customer/CustomerRegister'
import CustomerAccountHome from './customer/CustomerAccountHome'
import CustomerProfile from './customer/CustomerProfile'
import CustomerOrders from './customer/CustomerOrders'
import CustomerAddresses from './customer/CustomerAddresses'
import CustomerFavourites from './customer/CustomerFavourites'
import './checkout/CheckoutAccount.css'
import './checkout/CheckoutAddresses.css'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/restaurants" element={<Restaurants />} />
      <Route path="/r/:slug" element={<Storefront />} />
      <Route path="/r/:slug/checkout" element={<Checkout />} />
      <Route path="/order/success" element={<OrderStatus />} />
      <Route path="/account/login" element={<CustomerLogin />} />
      <Route path="/account/register" element={<CustomerRegister />} />
      <Route path="/account" element={<CustomerAccountHome />} />
      <Route path="/account/profile" element={<CustomerProfile />} />
      <Route path="/account/orders" element={<CustomerOrders />} />
      <Route path="/account/addresses" element={<CustomerAddresses />} />
      <Route path="/account/favourites" element={<CustomerFavourites />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
      <Route path="/kds" element={<ProtectedRoute><KitchenDisplay /></ProtectedRoute>} />
      <Route path="/printers" element={<ProtectedRoute><PrinterManagement /></ProtectedRoute>} />
      <Route path="/print-history" element={<ProtectedRoute><PrintHistory /></ProtectedRoute>} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/menu" element={<ProtectedRoute><MenuBuilder /></ProtectedRoute>} />
      <Route path="/menu/modifiers" element={<ProtectedRoute><ModifierGroups /></ProtectedRoute>} />
      <Route path="/opening-hours" element={<ProtectedRoute><OpeningHours /></ProtectedRoute>} />
      <Route path="/branding" element={<ProtectedRoute><Branding /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><RestaurantSettings /></ProtectedRoute>} />
      <Route path="/delivery-areas" element={<ProtectedRoute><DeliveryAreas /></ProtectedRoute>} />
      <Route path="/delivery-map" element={<ProtectedRoute><DeliveryMap /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
