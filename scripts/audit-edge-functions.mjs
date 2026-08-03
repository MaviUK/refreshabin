import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const functionsDir = path.join(root, 'supabase', 'functions')
const configPath = path.join(root, 'supabase', 'config.toml')
const publicWithoutJwt = new Set(['create-checkout-session', 'stripe-webhook'])
const userContextFunctions = new Set(['admin-refund-payment', 'scan-menu-import'])

const entries = await readdir(functionsDir, { withFileTypes: true })
const functionNames = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const config = await readFile(configPath, 'utf8')
const configured = new Map()
let current = null

for (const rawLine of config.split(/\r?\n/)) {
  const line = rawLine.trim()
  const section = line.match(/^\[functions\.([^\]]+)\]$/)
  if (section) {
    current = section[1]
    continue
  }
  const jwt = line.match(/^verify_jwt\s*=\s*(true|false)$/)
  if (current && jwt) configured.set(current, jwt[1] === 'true')
}

const failures = []
for (const name of functionNames) {
  if (!configured.has(name)) {
    failures.push(`${name}: missing explicit verify_jwt setting in supabase/config.toml`)
    continue
  }

  const verifyJwt = configured.get(name)
  if (!verifyJwt && !publicWithoutJwt.has(name)) {
    failures.push(`${name}: verify_jwt=false is not allowed for a privileged function`)
  }

  const source = await readFile(path.join(functionsDir, name, 'index.ts'), 'utf8')
  if (!/request\.method|req\.method/.test(source)) {
    failures.push(`${name}: request method is not validated`)
  }

  if (name === 'stripe-webhook' && !/stripe-signature/i.test(source)) {
    failures.push(`${name}: Stripe signature verification was not detected`)
  }

  if (userContextFunctions.has(name) && !/Authorization|authorization/.test(source)) {
    failures.push(`${name}: user-context function does not forward the Authorization header`)
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
