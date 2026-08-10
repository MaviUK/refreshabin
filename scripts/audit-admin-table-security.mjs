import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const migrationsDir = path.join(root, 'supabase', 'migrations')
const lockdownFile = path.join(migrationsDir, '20260803231000_lock_down_platform_admin_tables.sql')
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()

const discovered = new Set()
for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), 'utf8')
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(platform_[a-z0-9_]+)/gi
  for (const match of sql.matchAll(pattern)) discovered.add(match[1].toLowerCase())
}

const lockdownSql = await readFile(lockdownFile, 'utf8')
const protectedTables = new Set(
  [...lockdownSql.matchAll(/'([a-z0-9_]+)'/gi)].map((match) => match[1].toLowerCase()),
)

const failures = []
for (const table of [...discovered].sort()) {
  if (!protectedTables.has(table)) failures.push(`${table}: missing from the central admin-table lockdown migration`)
}

for (const required of ['edge_function_rate_limits', 'stripe_webhook_events']) {
  if (!protectedTables.has(required)) failures.push(`${required}: sensitive infrastructure table is not protected`)
}

if (!/enable row level security/i.test(lockdownSql)) failures.push('lockdown migration does not enable row level security')
if (!/revoke all on table/i.test(lockdownSql)) failures.push('lockdown migration does not revoke direct client table privileges')
if (!/public, anon, authenticated/i.test(lockdownSql)) failures.push('lockdown migration must revoke public, anon and authenticated roles')

if (failures.length) {
  console.error('Platform admin table security audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Platform admin table security audit passed for ${discovered.size} platform tables.`)
