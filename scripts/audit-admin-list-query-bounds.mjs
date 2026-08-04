import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationDir = path.join(process.cwd(), 'supabase', 'migrations')
const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort()
const sql = (await Promise.all(files.map((name) => readFile(path.join(migrationDir, name), 'utf8')))).join('\n')

const requirements = [
  ['get_platform_restaurants', /create or replace function public\.get_platform_restaurants[\s\S]*?set statement_timeout = '10s'[\s\S]*?limit 250/i],
  ['get_platform_payments', /create or replace function public\.get_platform_payments[\s\S]*?set statement_timeout = '10s'[\s\S]*?processing_refunds as materialized/i],
  ['get_platform_support_cases', /create or replace function public\.get_platform_support_cases[\s\S]*?set statement_timeout = '8s'[\s\S]*?scoped as materialized/i],
  ['get_platform_admin_audit_log', /create or replace function public\.get_platform_admin_audit_log[\s\S]*?set statement_timeout = '10s'[\s\S]*?scoped as materialized/i],
]

const failures = requirements.filter(([, pattern]) => !pattern.test(sql)).map(([name]) => name)
if (failures.length) {
  console.error('Admin list query-bound audit failed:')
  for (const name of failures) console.error(`- ${name} is missing required bounds or pre-aggregation`)
  process.exit(1)
}

console.log('Admin list query-bound audit passed.')
