import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const migrationsDir = path.join(root, 'supabase', 'migrations')
const criticalTables = [
  'orders',
  'order_items',
  'order_status_history',
  'restaurant_members',
  'restaurant_locations',
  'menu_categories',
  'menu_items',
  'menu_imports',
  'restaurant_printers',
  'print_jobs',
]

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
const migrationText = (await Promise.all(files.map(async (name) => readFile(path.join(migrationsDir, name), 'utf8')))).join('\n').toLowerCase()
const failures = []

for (const table of criticalTables) {
  const created = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${table}\\b`, 'i').test(migrationText)
  if (!created) continue

  const rlsEnabled = new RegExp(`alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(migrationText)
  if (!rlsEnabled) failures.push(`${table}: RLS is not enabled in the migration chain`)

  const tablePolicy = new RegExp(`create\\s+policy[\\s\\S]{0,800}?on\\s+(?:public\\.)?${table}\\b`, 'i').test(migrationText)
  if (!tablePolicy) failures.push(`${table}: no RLS policy was found in the migration chain`)
}

const auditMigration = files.find((name) => name.endsWith('_add_operational_rls_audit.sql'))
if (!auditMigration) {
  failures.push('Operational RLS runtime audit migration is missing')
} else {
  const auditText = await readFile(path.join(migrationsDir, auditMigration), 'utf8')
  for (const table of criticalTables) {
    if (!auditText.includes(`('${table}',`)) failures.push(`${table}: missing from runtime RLS audit inventory`)
  }
}

const broadMutationPolicy = /create\s+policy[\s\S]{0,500}?for\s+(?:all|insert|update|delete)[\s\S]{0,500}?(?:using|with\s+check)\s*\(\s*true\s*\)/gi
for (const match of migrationText.matchAll(broadMutationPolicy)) {
  const excerpt = match[0].replace(/\s+/g, ' ').slice(0, 240)
  failures.push(`Unrestricted mutation policy detected: ${excerpt}`)
}

if (failures.length) {
  console.error('Operational RLS audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Operational RLS audit passed for ${criticalTables.length} critical tables.`)
