export type AdminRole = 'super_admin' | 'operations' | 'support' | 'finance'

export type AdminPermission =
  | 'overview:view'
  | 'restaurants:view'
  | 'restaurants:manage'
  | 'orders:view'
  | 'orders:manage'
  | 'orders:customer_details'
  | 'customers:view'
  | 'support:view'
  | 'support:manage'
  | 'finance:view'
  | 'finance:manage'
  | 'audit:view'
  | 'admins:view'
  | 'admins:manage'

export type AdminIdentity = {
  user_id: string
  email: string
  display_name: string
  role: AdminRole
  permissions: AdminPermission[]
}

export const adminRoleLabels: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
}

export const adminRoleDescriptions: Record<AdminRole, string> = {
  super_admin: 'Full platform access, including administrator security and roles.',
  operations: 'Restaurants and order operations, without administrator or financial control.',
  support: 'Read-only restaurant, order and customer support access.',
  finance: 'Order, payment, refund and reporting access without restaurant control.',
}

export function hasAdminPermission(admin: AdminIdentity, permission: AdminPermission) {
  return admin.permissions.includes(permission)
}

export type RestaurantStatus = 'draft' | 'pending_approval' | 'active' | 'suspended' | 'rejected'

export type Restaurant = {
  id: string
  name: string
  slug: string
  status: RestaurantStatus
  email: string | null
  phone: string | null
  cuisines: string[] | null
  accepts_delivery: boolean
  accepts_collection: boolean
  accepting_orders: boolean
  minimum_order_pence: number | null
  delivery_fee_pence: number | null
  logo_url: string | null
  cover_url: string | null
  submitted_at: string | null
  approved_at: string | null
  approval_notes: string | null
  created_at: string
  updated_at: string
  menu_category_count: number
  menu_item_count: number
  order_count: number
  gross_sales_pence: number
  last_order_at: string | null
  location: {
    address_line_1?: string
    address_line_2?: string
    city?: string
    postcode?: string
  }
}

export const statusLabels: Record<RestaurantStatus, string> = {
  draft: 'Onboarding',
  pending_approval: 'Pending approval',
  active: 'Live',
  suspended: 'Suspended',
  rejected: 'Rejected',
}

export function formatMoney(pence: number | null | undefined) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((pence ?? 0) / 100)
}

export function formatDate(value: string | null | undefined, includeTime = true) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en-GB', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(new Date(value))
}
