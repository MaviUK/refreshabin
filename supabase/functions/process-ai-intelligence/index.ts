import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

type RunMode = 'daily' | 'weekly' | 'monthly'
type ProviderResult = { mode: RunMode; processed: number; failed: number; errors: unknown[]; generated_at: string }

interface IntelligenceProvider {
  readonly name: string
  run(client: SupabaseClient, mode: RunMode, limit: number): Promise<ProviderResult>
}

const internalProvider: IntelligenceProvider = {
  name: 'internal',
  async run(client, mode, limit) {
    const { data, error } = await client.rpc('run_ai_intelligence_cycle', { p_mode: mode, p_limit: limit })
    if (error) throw error
    return data as ProviderResult
  },
}

const providers: Record<string, IntelligenceProvider> = {
  internal: internalProvider,
  // Future provider adapters (OpenAI, Anthropic, etc.) must implement the same
  // run contract so dashboards, reports and audit traces remain provider-neutral.
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function serviceRoleRequest(req: Request) {
  const header = req.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

function autoMode(now = new Date()): RunMode {
  if (now.getUTCDate() === 1) return 'monthly'
  if (now.getUTCDay() === 1) return 'weekly'
  return 'daily'
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!serviceRoleRequest(req)) return json({ error: 'Service role required' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase service credentials are not configured' }, 500)

  let body: { mode?: RunMode | 'auto'; limit?: number } = {}
  try { body = await req.json() } catch { /* body is optional */ }
  const requestedMode = body.mode || 'auto'
  const mode: RunMode = requestedMode === 'auto' ? autoMode() : requestedMode
  if (!['daily', 'weekly', 'monthly'].includes(mode)) return json({ error: 'Invalid mode' }, 400)
  const limit = Math.min(Math.max(Number(body.limit || 500), 1), 500)

  const providerName = (Deno.env.get('AI_PROVIDER') || 'internal').toLowerCase()
  const provider = providers[providerName]
  if (!provider) return json({ error: `AI provider ${providerName} is not installed`, provider: providerName }, 503)

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const result = await provider.run(client, mode, limit)
    return json({ provider: provider.name, mode, result })
  } catch (error) {
    console.error('process-ai-intelligence failed', error)
    return json({ error: error instanceof Error ? error.message : 'Intelligence generation failed', provider: provider.name, mode }, 500)
  }
})
