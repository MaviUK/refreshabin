import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const functionsDir = path.join(root, 'supabase', 'functions')
const configPath = path.join(root, 'supabase', 'config.toml')
const publicWithoutJwt = new Set(['create-checkout-session', 'create-gift-card-checkout', 'finalize-gift-card-purchase', 'stripe-webhook', 'marketing-resend-webhook'])
const userContextFunctions = new Set(['admin-refund-payment', 'scan-menu-import'])
const browserFacingFunctions = new Set(['create-checkout-session', 'create-gift-card-checkout', 'finalize-gift-card-purchase', 'scan-menu-import', 'admin-refund-payment'])

const entries = await readdir(functionsDir, { withFileTypes: true })
const functionNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
const config = await readFile(configPath, 'utf8')
const configured = new Map()
let current = null

for (const rawLine of config.split(/\r?\n/)) {
  const line = rawLine.trim()
  const section = line.match(/^\[functions\.([^\]]+)\]$/)
  if (section) { current = section[1]; continue }
  const jwt = line.match(/^verify_jwt\s*=\s*(true|false)$/)
  if (current && jwt) configured.set(current, jwt[1] === 'true')
}

const failures = []
for (const name of functionNames) {
  if (!configured.has(name)) { failures.push(`${name}: missing explicit verify_jwt setting in supabase/config.toml`); continue }
  const verifyJwt = configured.get(name)
  if (!verifyJwt && !publicWithoutJwt.has(name)) failures.push(`${name}: verify_jwt=false is not allowed for a privileged function`)

  const source = await readFile(path.join(functionsDir, name, 'index.ts'), 'utf8')
  if (!/request\.method|req\.method/.test(source)) failures.push(`${name}: request method is not validated`)
  if (name === 'stripe-webhook' && !/stripe-signature/i.test(source)) failures.push(`${name}: Stripe signature verification was not detected`)
  if (userContextFunctions.has(name) && !/Authorization|authorization/.test(source)) failures.push(`${name}: user-context function does not forward the Authorization header`)

  if (browserFacingFunctions.has(name)) {
    if (/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(source)) failures.push(`${name}: browser-facing function must not use wildcard CORS`)
    if (!/content-length|maxBodyBytes|MAX_BODY_BYTES|Request body is too large/i.test(source)) failures.push(`${name}: browser-facing function must enforce a request-size limit`)
    if (!/consume_edge_function_rate_limit/.test(source)) failures.push(`${name}: browser-facing function must use the database-backed rate limiter`)
    if (!/Retry-After/.test(source)) failures.push(`${name}: rate-limited responses must include Retry-After`)
    if (!/CORS_ALLOWED_ORIGINS/.test(source)) failures.push(`${name}: browser-facing function must use the configured origin allow-list`)
  }

  if (name === 'scan-menu-import') {
    if (!/allowedMimeTypes/.test(source) || !/application\/pdf/.test(source)) failures.push(`${name}: menu file MIME types must be allow-listed`)
    if (!/1500/.test(source) || !/scan_instructions/.test(source)) failures.push(`${name}: scan instructions must have a bounded length`)
    if (!/15 \* 1024 \* 1024/.test(source)) failures.push(`${name}: uploaded menu size must remain capped at 15 MB`)
  }

  if (name === 'admin-refund-payment') {
    if (!/PLATFORM_ADMIN_URL/.test(source)) failures.push(`${name}: admin origin must be explicitly allow-listed`)
    if (!/admin:\$\{userData\.user\.id\}/.test(source)) failures.push(`${name}: administrator-specific rate limiting was not detected`)
    if (!/order:\$\{orderId\}/.test(source)) failures.push(`${name}: order-specific refund rate limiting was not detected`)
    if (/return reply\(request,\s*\{\s*error:\s*(message|internalMessage)/.test(source)) failures.push(`${name}: internal Stripe errors must not be returned directly to clients`)
  }

  if (name === 'stripe-webhook') {
    if (!/MAX_BODY_BYTES/.test(source) || !/413/.test(source)) failures.push(`${name}: webhook payload size must be capped`)
    if (!/constructEventAsync[\s\S]*300/.test(source)) failures.push(`${name}: Stripe signature timestamp tolerance must remain explicit`)
    if (!/MAX_EVENT_AGE_SECONDS/.test(source) || !/MAX_FUTURE_SKEW_SECONDS/.test(source)) failures.push(`${name}: event-age validation was not detected`)
    if (!/claim_stripe_webhook_event/.test(source) || !/complete_stripe_webhook_event/.test(source)) failures.push(`${name}: atomic webhook event lifecycle was not detected`)
    if (/console\.error\('Invalid Stripe signature',\s*error/.test(source)) failures.push(`${name}: signature failures must not log raw verification errors`)
  }

  if (name === 'marketing-resend-webhook') {
    if (!/svix-signature/i.test(source) || !/new Webhook\(secret\)\.verify/.test(source)) failures.push(`${name}: signed Svix webhook verification was not detected`)
    if (!/RESEND_WEBHOOK_SECRET/.test(source)) failures.push(`${name}: Resend webhook secret is not required`)
    if (!/MAX_BODY_BYTES/.test(source) || !/413/.test(source)) failures.push(`${name}: webhook payload size must be capped`)
    if (/return new Response\(error\.message/.test(source)) failures.push(`${name}: internal database errors must not be returned to the webhook caller`)
  }
}

for (const name of configured.keys()) {
  if (!functionNames.includes(name)) failures.push(`${name}: configured function directory does not exist`)
}

if (failures.length) {
  console.error('Edge Function security audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`Edge Function security audit passed for ${functionNames.length} functions.`)
