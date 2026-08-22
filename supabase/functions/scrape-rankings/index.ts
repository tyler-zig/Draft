import { createClient } from 'npm:@supabase/supabase-js@2'
import { appendRankingHistory, collectAdp, collectExpertBatch, collectRankings, type RankingSet } from '../_shared/ranking-collector.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expected = Deno.env.get('RANKINGS_CRON_SECRET')
  if (!expected || request.headers.get('x-cron-secret') !== expected) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase runtime credentials are unavailable' }, 500)
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const requested = await request.json().catch(() => ({})) as { trigger?: string; mode?: string; scoring?: string }
  const trigger = requested.trigger === 'manual' ? 'manual' : 'cron'
  const { data: run, error: runError } = await client.from('ranking_scrape_runs').insert({ trigger_source: trigger, status: 'running' }).select('id').single()
  if (runError) return json({ error: runError.message }, 500)

  try {
    if (requested.mode === 'experts') {
      const scoring = ['ppr', 'half', 'standard'].includes(requested.scoring ?? '') ? requested.scoring as 'ppr' | 'half' | 'standard' : 'ppr'
      const kind = `experts-${scoring}`
      const [{ data: current }, { data: cursorRow }] = await Promise.all([
        client.from('ranking_snapshots').select('payload').eq('kind', kind).maybeSingle(),
        client.from('ranking_scrape_cursors').select('cursor').eq('job_key', kind).maybeSingle(),
      ])
      const batch = await collectExpertBatch(scoring, current?.payload as Record<string, unknown> | null, cursorRow?.cursor ?? 0)
      const { error: snapshotError } = await client.from('ranking_snapshots').upsert({ kind, schema_version: 1, fetched_at: new Date(batch.payload.fetchedAt).toISOString(), payload: batch.payload, source: 'cron' })
      if (snapshotError) throw snapshotError
      await client.from('ranking_scrape_cursors').upsert({ job_key: kind, cursor: batch.nextCursor })
      const status = batch.failures.length ? 'partial' : 'succeeded', stats = { mode: 'experts', scoring, processed: batch.processed, directorySize: batch.directorySize, experts: batch.payload.expertCount, players: batch.payload.playerCount }
      await client.from('ranking_scrape_runs').update({ status, finished_at: new Date().toISOString(), stats, failures: batch.failures }).eq('id', run.id)
      return json({ runId: run.id, status, stats, failures: batch.failures })
    }
    if (requested.mode === 'adp') {
      const { data: previousAdp } = await client.from('ranking_snapshots').select('payload').eq('kind', 'adp-latest').maybeSingle()
      const adp = await collectAdp(previousAdp?.payload as { sets?: RankingSet[] } | null)
      const body = JSON.stringify(adp)
      const bucket = Deno.env.get('SUPABASE_DATA_BUCKET') ?? 'draft-data'
      const { error: storageError } = await client.storage.from(bucket).upload('rankings/adp-latest.json', body, {
        contentType: 'application/json', cacheControl: '300', upsert: true,
      })
      if (storageError) throw storageError
      const adpAt = new Date(adp.fetchedAt).toISOString()
      const { error: snapshotError } = await client.from('ranking_snapshots').upsert({
        kind: 'adp-latest', schema_version: adp.schemaVersion, fetched_at: adpAt, payload: adp, live_adp: adp, source: 'cron',
      })
      if (snapshotError) throw snapshotError
      const { error: artifactError } = await client.from('data_artifacts').upsert({
        kind: 'adp-latest', bucket, object_path: 'rankings/adp-latest.json', schema_version: adp.schemaVersion, generated_at: adpAt,
        byte_size: new TextEncoder().encode(body).length, metadata: { source: 'cron' }, live_adp: adp,
      })
      if (artifactError) throw artifactError
      const stats = { mode: 'adp', ...adp.stats }
      await client.from('ranking_scrape_runs').update({ status: 'succeeded', finished_at: new Date().toISOString(), stats }).eq('id', run.id)
      return json({ runId: run.id, status: 'succeeded', stats })
    }
    const { data: previousAdp } = await client.from('ranking_snapshots').select('payload').eq('kind', 'adp-latest').maybeSingle()
    const payload = await collectRankings(previousAdp?.payload as { sets?: RankingSet[] } | null)
    const { data: previousHistory } = await client.from('ranking_snapshots').select('payload').eq('kind', 'rankings-history').maybeSingle()
    const history = appendRankingHistory(previousHistory?.payload as Record<string, unknown> | null, payload)
    const status = payload.failures.length ? 'partial' : 'succeeded'
    const { error: snapshotError } = await client.from('ranking_snapshots').upsert([
      { kind: 'rankings-latest', schema_version: payload.schemaVersion, fetched_at: new Date(payload.fetchedAt).toISOString(), payload, source: 'cron' },
      { kind: 'rankings-history', schema_version: history.schemaVersion, fetched_at: new Date(history.generatedAt).toISOString(), payload: history, source: 'cron' },
    ])
    if (snapshotError) throw snapshotError
    await client.from('ranking_scrape_runs').update({ status, finished_at: new Date().toISOString(), stats: payload.stats, failures: payload.failures }).eq('id', run.id)
    return json({ runId: run.id, status, stats: payload.stats, failures: payload.failures })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await client.from('ranking_scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message }).eq('id', run.id)
    return json({ runId: run.id, status: 'failed', error: message }, 500)
  }
})
