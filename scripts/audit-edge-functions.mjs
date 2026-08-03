import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const functionsDir = path.join(root, 'supabase', 'functions')
const configPath = path.join(root, 'supabase', 'config.toml')
const publicWithoutJwt = new Set(['create-checkout-session', 'stripe-webhook'])
const userContextFunctions = new Set(['admin-refund-payment', 'scan-menu-import'])
const browserFacingFunctions = new Set(['create-checkout-session', 'scan-menu-import'])

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
    if (!/content-length|maxBodyBytes|Request body is too large/i.test(source)) failures.push(`${name}: browser-facing function must enforce a request-size limit`)
    if (!/consume_edge_function_rate_limit/.test(source)) failures.push(`${name}: browser-facing function must use the database-backed rate limiter`)
    if (!/Retry-After/.test(source)) failures.push(`${name}: rate-limited responses must include Retry-After`)
    if (!/CORS_ALLOWED_ORIGINS/.test(source)) failures.push(`${name}: browser-facing function must use the configured origin allow-list`)
  }

  if (name === 'scan-menu-import') {
    if (!/allowedMimeTypes/.test(source) || !/application\/pdf/.test(source)) failures.push(`${name}: menu file MIME types must be allow-listed`)
    if (!/1500/.test(source) || !/scan_instructions/.test(source)) failures.push(`${name}: scan instructions must have a bounded length`)
    if (!/15 \* 1024 \* 1024/.test(source)) failures.push(`${name}: uploaded menu size must remain capped at 15 MB`)
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
