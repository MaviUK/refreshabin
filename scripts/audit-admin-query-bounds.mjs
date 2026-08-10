import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
let sql = ''
for (const file of files) sql += `\n-- ${file}\n${await readFile(path.join(dir, file), 'utf8')}\n`

const checks = [
  ['customer search result cap', /create or replace function public\.get_platform_customers[\s\S]*?limit 250/i],
  ['customer order pre-aggregation', /order_totals as materialized[\s\S]*?group by o\.customer_user_id/i],
  ['customer query timeout', /get_platform_customers[\s\S]*?set statement_timeout = '8s'/i],
  ['analytics bounded order range', /ranged_orders as materialized[\s\S]*?activity_at[\s\S]*?>= from_at[\s\S]*?< to_at/i],
  ['analytics shared daily summary', /daily_summary as materialized/i],
  ['analytics query timeout', /get_platform_analytics[\s\S]*?set statement_timeout = '12s'/i],
]

const failures = checks.filter(([, pattern]) => !pattern.test(sql)).map(([label]) => label)
if (failures.length) {
  console.error('Admin query-bound audit failed:')
  for (const failure of failures) console.error(`- Missing ${failure}`)
  process.exit(1)
}
console.log('Admin query-bound audit passed.')
