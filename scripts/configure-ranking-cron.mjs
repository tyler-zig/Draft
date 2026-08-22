import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

async function loadProjectEnv(file) {
  try {
    const contents = await readFile(resolve(file), 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]] !== undefined) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      else value = value.replace(/\s+#.*$/, '').trim()
      process.env[match[1]] = value
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

await loadProjectEnv('.env.local')
await loadProjectEnv('.env')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const schedule = process.env.RANKINGS_CRON_SCHEDULE || '17 */6 * * *'
const intelligenceSchedule = process.env.INTELLIGENCE_CRON_SCHEDULE || '23 */12 * * *'
const adpSchedule = process.env.ADP_CRON_SCHEDULE || '*/15 * * * *'
if (!url || !serviceKey) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.')

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

// Reschedule live ADP without rotating the shared cron secret.
if (process.argv.includes('--adp-schedule-only')) {
  const { data: jobId, error } = await client.rpc('schedule_ranking_adp', { p_schedule: adpSchedule })
  if (error) throw new Error(`Could not reschedule live ADP: ${error.message}`)
  console.log(`Scheduled draft-assistant-rankings-adp as job ${jobId} (${adpSchedule}, UTC).`)
  process.exit(0)
}

// Rotate the shared secret atomically on every setup. It is sent to the Edge
// Function secret store and Vault, but never printed or persisted in the repo.
const cronSecret = randomBytes(32).toString('base64url')
const cli = resolve('node_modules/supabase/dist/supabase.js')
const secretResult = spawnSync(process.execPath, [cli, 'secrets', 'set', `RANKINGS_CRON_SECRET=${cronSecret}`], { stdio: 'inherit' })
if (secretResult.status !== 0) throw new Error(`Could not configure the Edge Function cron secret${secretResult.error ? `: ${secretResult.error.message}` : '.'}`)

const { data: jobId, error } = await client.rpc('configure_ranking_cron', {
  p_project_url: url,
  p_cron_secret: cronSecret,
  p_schedule: schedule,
  p_intelligence_schedule: intelligenceSchedule,
  p_adp_schedule: adpSchedule,
})
if (error) throw new Error(`Could not configure pg_cron: ${error.message}`)
console.log(`Scheduled draft-assistant-rankings as job ${jobId} (${schedule}, UTC).`)
console.log(`Scheduled draft-assistant-intelligence (${intelligenceSchedule}, UTC).`)
console.log(`Scheduled draft-assistant-rankings-adp (${adpSchedule}, UTC).`)
