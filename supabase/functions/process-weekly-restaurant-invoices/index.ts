import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const money = (pence: number | bigint) => `£${(Number(pence || 0) / 100).toFixed(2)}`
const escapeCsv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

function previousWeek() {
  const now = new Date()
  const day = now.getUTCDay()
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)))
  const end = new Date(thisMonday)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

async function buildPdf(invoice: Record<string, any>, restaurant: Record<string, any>, orders: Record<string, any>[]) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  let page = document.addPage([595, 842])
  let y = 790

  const line = (label: string, value: string, strong = false) => {
    page.drawText(label, { x: 50, y, size: 10, font: strong ? bold : regular, color: rgb(0.12, 0.12, 0.12) })
    page.drawText(value, { x: 420, y, size: 10, font: strong ? bold : regular, color: rgb(0.12, 0.12, 0.12) })
    y -= 18
  }
  const ensureSpace = () => {
    if (y > 80) return
    page = document.addPage([595, 842])
    y = 790
  }

  page.drawText('ordered.food', { x: 50, y, size: 25, font: bold, color: rgb(0.08, 0.08, 0.08) }); y -= 34
  page.drawText('Weekly restaurant statement', { x: 50, y, size: 17, font: bold }); y -= 28
  line('Invoice number', invoice.invoice_number)
  line('Restaurant', restaurant.name)
  line('Period', `${invoice.period_start} to ${invoice.period_end}`)
  line('Generated', new Date().toLocaleString('en-GB'))
  y -= 10
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) }); y -= 24
  line('Customer payments', money(invoice.gross_sales_pence), true)
  line('Refunds', `-${money(invoice.refunded_pence)}`)
  line('Stripe processing fees', `-${money(invoice.stripe_fees_pence)}`)
  line('ordered.food commission', `-${money(invoice.ordered_food_fees_pence)}`)
  line('VAT on ordered.food commission', `-${money(invoice.ordered_food_vat_pence)}`)
  y -= 4
  line('Net restaurant settlement', money(invoice.net_settlement_pence), true)
  y -= 20

  page.drawText('Order breakdown', { x: 50, y, size: 14, font: bold }); y -= 22
  for (const order of orders) {
    ensureSpace()
    page.drawText(`#${order.order_number}`, { x: 50, y, size: 9, font: bold })
    page.drawText(new Date(order.paid_at ?? order.created_at).toLocaleDateString('en-GB'), { x: 95, y, size: 9, font: regular })
    page.drawText(money(order.total_pence), { x: 210, y, size: 9, font: regular })
    page.drawText(`Stripe -${money(order.stripe_processing_fee_pence)}`, { x: 285, y, size: 9, font: regular })
    page.drawText(`OF -${money(Number(order.platform_commission_pence) + Number(order.platform_commission_vat_pence))}`, { x: 390, y, size: 9, font: regular })
    page.drawText(money(Math.max(0, Number(order.total_pence) - Number(order.refunded_pence) - Number(order.stripe_processing_fee_pence) - Number(order.platform_commission_pence) - Number(order.platform_commission_vat_pence))), { x: 495, y, size: 9, font: bold })
    y -= 16
  }

  page.drawText('This statement summarises restaurant sales and settlement deductions. It is not a customer receipt.', { x: 50, y: 40, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) })
  return document.save()
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? Deno.env.get('SUPABASE_RESEND_SECRET') ?? Deno.env.get('RESEND_SECRET')
  const authorization = request.headers.get('Authorization') ?? ''
  if (!supabaseUrl || !serviceKey || !resendKey) return json({ error: 'Invoice processor is not configured.' }, 500)
  if (authorization !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized.' }, 401)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: { period_start?: string; period_end?: string; restaurant_id?: string; resend?: boolean } = {}
  try { body = await request.json() } catch { /* scheduled run uses defaults */ }
  const fallback = previousWeek()
  const periodStart = body.period_start || fallback.start
  const periodEnd = body.period_end || fallback.end

  const restaurantQuery = admin.from('restaurants').select('id,name,email,slug,status').in('status', ['active', 'approved'])
  const { data: restaurants, error: restaurantError } = body.restaurant_id
    ? await restaurantQuery.eq('id', body.restaurant_id)
    : await restaurantQuery
  if (restaurantError) return json({ error: restaurantError.message }, 500)

  const results: Array<Record<string, unknown>> = []
  for (const restaurant of restaurants ?? []) {
    if (!restaurant.email) {
      results.push({ restaurant_id: restaurant.id, status: 'skipped', reason: 'Missing restaurant email' })
      continue
    }

    try {
      const { data: invoiceId, error: generateError } = await admin.rpc('generate_restaurant_weekly_invoice', {
        p_restaurant_id: restaurant.id,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      })
      if (generateError) throw generateError

      const [{ data: invoice, error: invoiceError }, { data: orders, error: ordersError }] = await Promise.all([
        admin.from('restaurant_weekly_invoices').select('*').eq('id', invoiceId).single(),
        admin.from('orders').select('order_number,created_at,paid_at,total_pence,refunded_pence,stripe_processing_fee_pence,platform_commission_pence,platform_commission_vat_pence,fulfilment_method').eq('restaurant_id', restaurant.id).in('payment_status', ['paid', 'partially_refunded', 'refunded']).gte('paid_at', `${periodStart}T00:00:00Z`).lt('paid_at', `${periodEnd}T23:59:59.999Z`).order('paid_at'),
      ])
      if (invoiceError || !invoice) throw invoiceError ?? new Error('Invoice was not generated')
      if (ordersError) throw ordersError
      if (invoice.status === 'sent' && !body.resend) {
        results.push({ restaurant_id: restaurant.id, invoice_id: invoice.id, status: 'already_sent' })
        continue
      }

      const pdfBytes = await buildPdf(invoice, restaurant, orders ?? [])
      const csvRows = [
        ['Order', 'Paid date', 'Fulfilment', 'Customer paid', 'Refunds', 'Stripe fee', 'ordered.food fee', 'VAT', 'Restaurant net'],
        ...(orders ?? []).map((order) => [
          order.order_number,
          order.paid_at ?? order.created_at,
          order.fulfilment_method,
          (order.total_pence / 100).toFixed(2),
          (order.refunded_pence / 100).toFixed(2),
          (order.stripe_processing_fee_pence / 100).toFixed(2),
          (order.platform_commission_pence / 100).toFixed(2),
          (order.platform_commission_vat_pence / 100).toFixed(2),
          (Math.max(0, order.total_pence - order.refunded_pence - order.stripe_processing_fee_pence - order.platform_commission_pence - order.platform_commission_vat_pence) / 100).toFixed(2),
        ]),
      ]
      const csv = csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n')
      const basePath = `${restaurant.id}/${periodStart}_${periodEnd}`
      const pdfPath = `${basePath}/${invoice.invoice_number}.pdf`
      const csvPath = `${basePath}/${invoice.invoice_number}.csv`
      const [pdfUpload, csvUpload] = await Promise.all([
        admin.storage.from('restaurant-invoices').upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true }),
        admin.storage.from('restaurant-invoices').upload(csvPath, new TextEncoder().encode(csv), { contentType: 'text/csv', upsert: true }),
      ])
      if (pdfUpload.error) throw pdfUpload.error
      if (csvUpload.error) throw csvUpload.error

      const attachments = [
        { filename: `${invoice.invoice_number}.pdf`, content: btoa(String.fromCharCode(...pdfBytes)) },
        { filename: `${invoice.invoice_number}.csv`, content: btoa(unescape(encodeURIComponent(csv))) },
      ]
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'ordered.food Finance <finance@ordered.food>',
          to: [restaurant.email],
          subject: `${restaurant.name} weekly sales statement · ${periodStart} to ${periodEnd}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1>Weekly sales statement</h1><p>Hello ${restaurant.name},</p><p>Your ordered.food statement for <strong>${periodStart} to ${periodEnd}</strong> is attached.</p><table style="width:100%;border-collapse:collapse"><tr><td>Customer payments</td><td style="text-align:right">${money(invoice.gross_sales_pence)}</td></tr><tr><td>Stripe fees</td><td style="text-align:right">-${money(invoice.stripe_fees_pence)}</td></tr><tr><td>ordered.food fees including VAT</td><td style="text-align:right">-${money(Number(invoice.ordered_food_fees_pence) + Number(invoice.ordered_food_vat_pence))}</td></tr><tr><td style="font-weight:bold;padding-top:12px">Net settlement</td><td style="text-align:right;font-weight:bold;padding-top:12px">${money(invoice.net_settlement_pence)}</td></tr></table><p>You can also view your statement history in Restaurant Portal → Finance.</p></div>`,
          attachments,
        }),
      })
      const emailBody = await emailResponse.text()
      if (!emailResponse.ok) throw new Error(`Resend ${emailResponse.status}: ${emailBody}`)

      await admin.from('restaurant_weekly_invoices').update({
        status: 'sent', pdf_path: pdfPath, csv_path: csvPath, sent_to: restaurant.email,
        sent_at: new Date().toISOString(), send_error: null, updated_at: new Date().toISOString(),
      }).eq('id', invoice.id)
      results.push({ restaurant_id: restaurant.id, invoice_id: invoice.id, status: 'sent' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown invoice error'
      await admin.from('restaurant_weekly_invoices').update({ status: 'failed', send_error: message, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurant.id).eq('period_start', periodStart).eq('period_end', periodEnd)
      results.push({ restaurant_id: restaurant.id, status: 'failed', error: message })
    }
  }

  return json({ period_start: periodStart, period_end: periodEnd, processed: results.length, results })
})
