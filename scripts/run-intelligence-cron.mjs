import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

for (const file of ['.env.local', '.env']) {
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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Supabase URL and service-role key are required.')
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const startedAt = new Date().toISOString()
const { data: requestId, error: invokeError } = await client.rpc('invoke_intelligence_sync')
if (invokeError) throw new Error(invokeError.message)
console.log(`Queued intelligence sync request ${requestId}.`)

for (let attempt = 0; attempt < 36; attempt += 1) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
  const { data: run, error } = await client.from('intelligence_sync_runs').select('id,status,stats,error,started_at,finished_at').gte('started_at', startedAt).order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!run || run.status === 'running') continue
  console.log(JSON.stringify(run, null, 2))
  process.exitCode = run.status === 'failed' ? 1 : 0
  return
}
throw new Error('The intelligence sync did not finish within three minutes. Check Edge Function logs and intelligence_sync_runs.')
