import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
const sql = (await Promise.all(files.map((name) => readFile(path.join(migrationsDir, name), 'utf8')))).join('\n').toLowerCase()

const requiredIndexes = [
  ['orders_restaurant_created_idx', 'restaurant order history and analytics'],
  ['orders_status_created_idx', 'live order and attention queues'],
  ['orders_payment_status_created_idx', 'payment and financial reporting'],
  ['order_status_history_order_created_idx', 'order timelines'],
  ['print_jobs_status_created_idx', 'failed and queued printer jobs'],
  ['print_jobs_order_created_idx', 'order recovery printer lookup'],
  ['platform_support_cases_status_updated_idx', 'support case queues'],
  ['platform_support_cases_assigned_updated_idx', 'assigned support queues'],
  ['platform_support_activities_case_created_idx', 'support activity timelines'],
  ['platform_payouts_restaurant_created_idx', 'restaurant payout history'],
  ['platform_payouts_status_created_idx', 'payout operations queues'],
  ['platform_risk_reviews_status_created_idx', 'risk investigation queues'],
  ['platform_report_runs_status_created_idx', 'scheduled report worker queue'],
  ['menu_imports_restaurant_created_idx', 'restaurant menu import history'],
]

const failures = []
for (const [indexName, purpose] of requiredIndexes) {
  if (!sql.includes(indexName)) failures.push(`${indexName}: missing index for ${purpose}`)
}

if (!/create\s+index\s+if\s+not\s+exists/i.test(sql)) {
  failures.push('performance indexes should be created idempotently with IF NOT EXISTS')
}

if (failures.length) {
  console.error('Platform performance index audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Platform performance index audit passed for ${requiredIndexes.length} critical indexes.`)
