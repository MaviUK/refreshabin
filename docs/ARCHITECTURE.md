# ordered.food architecture

This document is the source of truth for what we are building and how the main parts fit together.

## Product surfaces

### Customer

- Web/PWA first, with Android and iPhone apps later
- Browse restaurants
- Search and filters
- Restaurant pages and menus
- Basket and checkout
- Stripe payment
- Live order tracking
- Order history and account

### Restaurant

- Android application
- Sign in and staff accounts
- Live incoming orders
- Accept or reject orders
- Set preparation time
- Update order status
- Pause orders or close the restaurant
- Mark items sold out
- Bluetooth ESC/POS thermal printing
- Manual reprint and persistent print queue
- Daily sales and order history

### Admin

- Web dashboard
- Approve and manage restaurants
- View customers, orders and payments
- Configure commission and VAT treatment
- Manage disputes, refunds and support
- Promotions, analytics and feature flags

## Repository structure

```text
apps/
  customer/           Customer web/PWA
  restaurant/         Restaurant Android app
  admin/              Admin dashboard

packages/
  ui/                 Shared design system
  types/              Shared TypeScript contracts
  api/                Shared API and Supabase clients
  order-engine/       Order state and pricing rules
  receipt-printer/    ESC/POS receipt generation and queue logic

supabase/
  migrations/         Versioned database migrations
  functions/          Server-side functions and webhooks
  seed/               Local development data

docs/
  ARCHITECTURE.md     This document
  PLAYBOOK.md         Product and engineering decisions
```

## Technology direction

- TypeScript throughout
- pnpm workspace monorepo
- React-based customer and admin applications
- Android restaurant application with native Bluetooth printer support
- Supabase for Postgres, authentication, storage and realtime
- Stripe Connect using destination charges and application fees
- Row Level Security on all tenant-owned data

## Core domains

### Identity and access

- Customers
- Restaurant owners and staff
- Platform administrators
- Role-based access with explicit restaurant membership

### Restaurants

- Business details
- Public slug such as `ordered.food/the-pizza-place`
- Branding and images
- Opening hours
- Service modes: delivery and collection
- Availability and temporary pauses

### Menus

- Categories
- Items
- Prices
- Variants and modifier groups
- Add-ons
- Allergens and dietary information
- Availability and sold-out state

### Orders

The order engine owns the state machine and pricing snapshot.

Proposed states:

```text
pending_payment
paid
sent_to_restaurant
accepted
rejected
preparing
ready
out_for_delivery
completed
cancelled
refunded
```

Order records must preserve the exact item names, options, prices, fees and tax values that applied when the order was placed.

### Payments and fees

Each order stores:

```text
food_subtotal
delivery_fee
customer_service_fee
discount_total
customer_total

platform_fee_net
platform_fee_vat
platform_fee_gross
restaurant_net
stripe_fee
```

Commission is configurable per restaurant and must never be hard-coded.

### Printing

Printing is isolated behind the `receipt-printer` package.

A persistent `print_jobs` queue supports:

```text
pending
printing
printed
failed
cancelled
```

Jobs are retryable, idempotent and linked to an order. The restaurant app handles Bluetooth connection, printer selection and local retry behaviour.

### Integrations

External POS systems are not required at launch, but integration boundaries are established from the beginning.

```text
manual
goodtill
square
epos_now
lightspeed
```

Customer and order logic must not depend directly on a particular POS provider.

## First milestone

A restaurant owner can:

1. Create an account
2. Create a restaurant
3. Upload branding
4. Set opening hours
5. Build a menu with categories, items and modifiers
6. Publish a public restaurant page

## Engineering rules

- Business rules live outside screen components
- Shared contracts live in `packages/types`
- Database changes are made only through migrations
- Money is stored as integer pence, never floating-point values
- All timestamps are stored in UTC
- Public restaurant slugs are unique and stable
- Order pricing is calculated server-side and recorded as an immutable snapshot
- Features are delivered in small, usable milestones
- Architecture changes must be recorded in this document or the playbook
