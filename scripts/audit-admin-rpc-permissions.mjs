import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDir = path.resolve('supabase/migrations')
const files = (await readdir(migrationsDir))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()

const latestDefinitions = new Map()
const functionPattern = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)([\s\S]*?)\bas\s+(\$[a-z0-9_]*\$)([\s\S]*?)\4\s*;/gi

for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), 'utf8')
  for (const match of sql.matchAll(functionPattern)) {
    const [, name, rawArgs, declaration, , body] = match
    const argumentTypes = rawArgs
      .split(',')
      .map((argument) => argument.trim())
      .filter(Boolean)
      .map((argument) => argument
        .replace(/\s+default\s+[\s\S]*$/i, '')
        .replace(/^\w+\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim())
      .join(',')

    latestDefinitions.set(`${name}(${argumentTypes})`, {
      name,
      file,
      declaration,
      body,
    })
  }
}

const genericGuardAllowlist = new Set([
  'claim_platform_admin_access',
  'get_current_platform_admin',
  'is_platform_admin',
])

const sensitiveName = /^(get|list|search|manage|update|set|add|create|delete|recover|refund|approve|reject|suspend|reactivate|upsert|queue|complete)_platform_/
const failures = []

for (const [signature, definition] of latestDefinitions) {
  if (!sensitiveName.test(definition.name)) continue
  if (genericGuardAllowlist.has(definition.name)) continue

  const usesGenericGuard = /\bpublic\.is_platform_admin\s*\(\s*\)/i.test(definition.body)
  const usesScopedGuard = /\bprivate\.has_platform_admin_permission\s*\(/i.test(definition.body)

  if (usesGenericGuard && !usesScopedGuard) {
    failures.push(`${signature} — ${definition.file}`)
  }
}

if (failures.length) {
  console.error('Sensitive platform-admin RPCs using a generic administrator guard:')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('Use private.has_platform_admin_permission(...) with the narrowest applicable permission.')
  process.exit(1)
}

console.log(`Audited ${latestDefinitions.size} latest public function definitions; no generic sensitive admin guards remain.`)
