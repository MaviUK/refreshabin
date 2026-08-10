import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!supabaseUrl || !serviceKey || !resendKey) return json({ error: 'Report delivery is not configured' }, 500)

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const body = await req.json().catch(() => ({})) as { run_id?: string; queue_due?: boolean }

  if (body.queue_due !== false) {
    const { error: queueError } = await supabase.rpc('queue_due_platform_report_runs')
    if (queueError) return json({ error: queueError.message }, 500)
  }

  let query = supabase.from('platform_report_runs').select('*').eq('status', 'queued').order('created_at').limit(1)
  if (body.run_id) query = query.eq('id', body.run_id)
  const { data: run, error: runError } = await query.maybeSingle()
  if (runError) return json({ error: runError.message }, 500)
  if (!run) return json({ processed: false })

  const { data: claimed, error: claimError } = await supabase
    .from('platform_report_runs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle()
  if (claimError) return json({ error: claimError.message }, 500)
  if (!claimed) return json({ processed: false, reason: 'already_claimed' })

  try {
    const rows = await buildRows(supabase, run.report_type, run.period_from, run.period_to)
    const headers = rows.length ? Object.keys(rows[0]) : ['message']
    const csvRows = rows.length ? rows : [{ message: 'No records matched this report period.' }]
    const csv = [headers, ...csvRows.map((row) => headers.map((key) => row[key]))]
      .map((row) => row.map(csvCell).join(','))
      .join('\n')
    const fileName = `ordered-food-${run.report_type}-${run.period_from}-${run.period_to}.csv`

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'ordered.food <reports@ordered.food>',
        to: run.recipients,
        subject: `ordered.food ${run.report_type.replaceAll('_', ' ')} report`,
        html: `<h1>ordered.food report</h1><p>${run.period_from} to ${run.period_to}</p><p>${rows.length} data rows are attached.</p>`,
        attachments: [{ filename: fileName, content: btoa(unescape(encodeURIComponent(csv))) }],
      }),
    })
    if (!emailResponse.ok) throw new Error(`Resend failed: ${await emailResponse.text()}`)

    const { error: completeError } = await supabase.rpc('complete_platform_report_run', {
      p_run_id: run.id,
      p_status: 'completed',
      p_row_count: rows.length,
      p_file_name: fileName,
      p_error_message: null,
    })
    if (completeError) throw completeError

    return json({ processed: true, run_id: run.id, row_count: rows.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report delivery failed'
    await supabase.rpc('complete_platform_report_run', {
      p_run_id: run.id,
      p_status: 'failed',
      p_row_count: null,
      p_file_name: null,
      p_error_message: message,
    })
    return json({ error: message }, 500)
  }
})

async function buildRows(
  supabase: ReturnType<typeof createClient>,
  type: string,
  from: string,
  to: string,
): Promise<Record<string, unknown>[]> {
  if (type === 'financial_summary') {
    const { data, error } = await supabase.rpc('get_service_financial_report_export', { p_from: from, p_to: to })
    if (error) throw error
    return data ?? []
  }
  if (type === 'order_operations') {
    const { data, error } = await supabase
      .from('orders')
      .select('order_number,order_status,payment_status,fulfilment_method,total_pence,created_at,restaurants(name)')
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`)
      .order('created_at')
    if (error) throw error
    return data ?? []
  }
  if (type === 'support_sla') {
    const { data, error } = await supabase
      .from('platform_support_cases')
      .select('case_number,subject,status,priority,response_due_at,resolution_due_at,first_response_at,last_contact_at,created_at')
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`)
      .order('created_at')
    if (error) throw error
    return data ?? []
  }
  if (type === 'risk_signals') {
    const { data, error } = await supabase
      .from('platform_risk_reviews')
      .select('risk_type,severity,status,subject_type,subject_key,summary,created_at,resolved_at')
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`)
      .order('created_at')
    if (error) throw error
    return data ?? []
  }

  const { data, error } = await supabase
    .from('orders')
    .select('restaurant_id,total_pence,order_status,created_at,restaurants(name)')
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`)
  if (error) throw error

  const grouped = new Map<string, { restaurant: string; orders: number; gross_pence: number; cancelled_or_rejected: number }>()
  for (const order of data ?? []) {
    const id = String(order.restaurant_id)
    const restaurant = Array.isArray(order.restaurants) ? order.restaurants[0]?.name : order.restaurants?.name
    const current = grouped.get(id) ?? { restaurant: restaurant ?? 'Unknown restaurant', orders: 0, gross_pence: 0, cancelled_or_rejected: 0 }
    current.orders += 1
    current.gross_pence += Number(order.total_pence ?? 0)
    if (['cancelled', 'rejected'].includes(String(order.order_status))) current.cancelled_or_rejected += 1
    grouped.set(id, current)
  }
  return [...grouped.values()].sort((a, b) => b.gross_pence - a.gross_pence)
}
