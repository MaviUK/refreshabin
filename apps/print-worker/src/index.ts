import { createClient } from '@supabase/supabase-js'
import { printEscPosNetwork } from './drivers/escpos-network.js'

type ClaimedJob = {
  job_id: string
  restaurant_id: string
  order_id: string | null
  printer_id: string
  document_type: 'kitchen_ticket' | 'customer_receipt' | 'test_ticket'
  attempts: number
  payload: Record<string, unknown>
}

type Printer = {
  id: string
  name: string
  printer_type: 'escpos' | 'epson' | 'star' | 'sunmi' | 'browser'
  connection_type: 'network' | 'usb' | 'bluetooth' | 'cloud' | 'browser'
  connection_config: Record<string, unknown>
  copies: number
}

type OrderItem = {
  item_name: string
  quantity: number
  unit_price_pence: number
  customer_notes: string | null
}

type Order = {
  id: string
  order_number: number
  customer_first_name: string
  customer_last_name: string
  customer_phone: string
  fulfilment_method: 'delivery' | 'collection'
  address_line_1: string | null
  address_line_2: string | null
  town_city: string | null
  postcode: string | null
  delivery_instructions: string | null
  subtotal_pence: number
  delivery_fee_pence: number
  service_fee_pence: number
  discount_pence: number
  total_pence: number
  paid_at: string | null
  created_at: string
  restaurants: { name: string } | { name: string }[] | null
  order_items: OrderItem[]
}

type PrinterStatus = 'offline' | 'online' | 'printing' | 'error'

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PRINTER_ID'] as const

for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
)

const printerId = process.env.PRINTER_ID!
const pollIntervalMs = Math.max(1_000, Number(process.env.POLL_INTERVAL_MS ?? 5_000))
const heartbeatIntervalMs = Math.max(10_000, Number(process.env.HEARTBEAT_INTERVAL_MS ?? 20_000))
const dryRun = (process.env.PRINT_DRY_RUN ?? 'true').toLowerCase() !== 'false'
let stopping = false
let working = false

function restaurantName(value: Order['restaurants']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Restaurant'
  return value?.name ?? 'Restaurant'
}

function money(pence: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100)
}

function formatTicket(order: Order) {
  const lines = [
    restaurantName(order.restaurants).toUpperCase(),
    `ORDER #${order.order_number}`,
    `${order.fulfilment_method.toUpperCase()} - ${new Date(order.paid_at ?? order.created_at).toLocaleString('en-GB')}`,
    '-'.repeat(42),
  ]

  for (const item of order.order_items) {
    lines.push(`${item.quantity} x ${item.item_name}`)
    if (item.customer_notes?.trim()) lines.push(`  NOTE: ${item.customer_notes.trim()}`)
  }

  lines.push('-'.repeat(42))
  lines.push(`Customer: ${order.customer_first_name} ${order.customer_last_name}`)
  lines.push(`Phone: ${order.customer_phone}`)

  if (order.fulfilment_method === 'delivery') {
    lines.push(
      [order.address_line_1, order.address_line_2, order.town_city, order.postcode]
        .filter(Boolean)
        .join(', '),
    )
    if (order.delivery_instructions?.trim()) {
      lines.push(`Delivery note: ${order.delivery_instructions.trim()}`)
    }
  }

  lines.push('-'.repeat(42))
  lines.push(`Subtotal: ${money(order.subtotal_pence)}`)
  if (order.delivery_fee_pence) lines.push(`Delivery: ${money(order.delivery_fee_pence)}`)
  if (order.service_fee_pence) lines.push(`Service fee: ${money(order.service_fee_pence)}`)
  if (order.discount_pence) lines.push(`Discount: -${money(order.discount_pence)}`)
  lines.push(`TOTAL: ${money(order.total_pence)}`)
  lines.push('', '', '')

  return `${lines.join('\n')}\n`
}

function formatTestTicket(printer: Printer) {
  const now = new Date().toLocaleString('en-GB')
  return [
    'ORDERED.FOOD',
    'PRINTER TEST',
    '-'.repeat(42),
    `Printer: ${printer.name}`,
    `Type: ${printer.printer_type.toUpperCase()}`,
    `Connection: ${printer.connection_type}`,
    `Time: ${now}`,
    '-'.repeat(42),
    'If you can read this, your printer is',
    'connected and ready to receive orders.',
    '',
    'Test successful',
    '',
    '',
    '',
  ].join('\n')
}

async function fetchPrinter(): Promise<Printer> {
  const { data, error } = await supabase
    .from('restaurant_printers')
    .select('id, name, printer_type, connection_type, connection_config, copies')
    .eq('id', printerId)
    .eq('is_active', true)
    .single()

  if (error) throw new Error(`Unable to load printer: ${error.message}`)
  return data as Printer
}

async function fetchOrder(orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      customer_first_name,
      customer_last_name,
      customer_phone,
      fulfilment_method,
      address_line_1,
      address_line_2,
      town_city,
      postcode,
      delivery_instructions,
      subtotal_pence,
      delivery_fee_pence,
      service_fee_pence,
      discount_pence,
      total_pence,
      paid_at,
      created_at,
      restaurants(name),
      order_items(item_name, quantity, unit_price_pence, customer_notes)
    `)
    .eq('id', orderId)
    .single()

  if (error) throw new Error(`Unable to load order: ${error.message}`)
  return data as unknown as Order
}

async function sendToPrinter(printer: Printer, ticket: string) {
  if (dryRun) {
    console.log(`\n[DRY RUN] ${printer.name} (${printer.printer_type}/${printer.connection_type})`)
    console.log(ticket)
    return
  }

  if (printer.printer_type === 'escpos' && printer.connection_type === 'network') {
    await printEscPosNetwork(ticket, printer.connection_config)
    return
  }

  throw new Error(`Printer driver not implemented for ${printer.printer_type}/${printer.connection_type}`)
}

async function updateHeartbeat(printerIdValue: string, status: PrinterStatus, errorMessage?: string) {
  const { error } = await supabase.rpc('update_printer_heartbeat', {
    p_printer_id: printerIdValue,
    p_status: status,
    p_error: errorMessage ?? null,
  })

  if (error) console.error(`Unable to update printer heartbeat: ${error.message}`)
}

async function recordPrinterResult(printerIdValue: string, success: boolean, errorMessage?: string) {
  const { error } = await supabase.rpc('record_printer_result', {
    p_printer_id: printerIdValue,
    p_success: success,
    p_error: errorMessage ?? null,
  })

  if (error) console.error(`Unable to record printer result: ${error.message}`)
}

async function completeJob(jobId: string, success: boolean, errorMessage?: string) {
  const { error } = await supabase.rpc('complete_print_job', {
    p_job_id: jobId,
    p_success: success,
    p_error: errorMessage ?? null,
  })

  if (error) throw new Error(`Unable to complete print job: ${error.message}`)
}

async function processNextJob(printer: Printer) {
  if (working || stopping) return
  working = true

  try {
    const { data, error } = await supabase.rpc('claim_next_print_job', {
      p_printer_id: printer.id,
    })

    if (error) throw new Error(`Unable to claim print job: ${error.message}`)

    const job = (data?.[0] ?? null) as ClaimedJob | null
    if (!job) return

    await updateHeartbeat(printer.id, 'printing')

    try {
      let ticket: string
      let logLabel: string

      if (job.document_type === 'test_ticket') {
        ticket = formatTestTicket(printer)
        logLabel = 'printer test'
      } else {
        if (!job.order_id) throw new Error('Order print job is missing an order ID')
        const order = await fetchOrder(job.order_id)
        ticket = formatTicket(order)
        logLabel = `order #${order.order_number}`
      }

      for (let copy = 0; copy < Math.max(1, printer.copies); copy += 1) {
        await sendToPrinter(printer, ticket)
      }

      await completeJob(job.job_id, true)
      await recordPrinterResult(printer.id, true)
      console.log(`Printed job ${job.job_id} for ${logLabel}`)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Unknown print failure'
      await completeJob(job.job_id, false, message)
      await recordPrinterResult(printer.id, false, message)
      console.error(`Print job ${job.job_id} failed: ${message}`)
    }
  } finally {
    working = false
  }
}

async function main() {
  const printer = await fetchPrinter()
  await updateHeartbeat(printer.id, 'online')
  console.log(`Print worker started for ${printer.name}. Dry run: ${dryRun}`)

  const channel = supabase
    .channel(`print-worker:${printer.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'print_jobs',
        filter: `printer_id=eq.${printer.id}`,
      },
      () => void processNextJob(printer),
    )
    .subscribe()

  const pollTimer = setInterval(() => void processNextJob(printer), pollIntervalMs)
  const heartbeatTimer = setInterval(
    () => void updateHeartbeat(printer.id, working ? 'printing' : 'online'),
    heartbeatIntervalMs,
  )

  await processNextJob(printer)

  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`Received ${signal}; shutting down print worker.`)
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
    await updateHeartbeat(printer.id, 'offline')
    await supabase.removeChannel(channel)
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : 'Unknown worker failure'
  console.error(error)
  await updateHeartbeat(printerId, 'error', message)
  process.exit(1)
})
