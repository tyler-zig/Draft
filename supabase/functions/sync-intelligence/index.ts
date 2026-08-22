import { createClient } from 'npm:@supabase/supabase-js@2'
import { gamesFromCsv, observationsFromWeeklyCsv, publishedScheduleArtifact, refreshPublishedSchedule, SCHEDULE_URL, weeklyStatsUrl, type PublishedIntelligence } from '../_shared/schedule-refresh.ts'
import { SHARD_INDEX_PATH, buildPlayerShards, type ShardablePlayer } from '../_shared/shards.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const bucket = Deno.env.get('SUPABASE_DATA_BUCKET') || 'draft-data'
const objectPath = 'intelligence/latest.json'
const schedulePath = 'intelligence/schedule.json'
const userAgent = 'DraftAssistant-player-intelligence/1.0'

/**
 * Republishes the sharded read path from the artifact this run just produced.
 *
 * The client reads one player out of a bucket rather than downloading the
 * ~17 MB monolith, so the buckets have to be rewritten whenever the monolith
 * is -- otherwise the sharded path would serve whatever the last publish left
 * behind. Uploading them here is what keeps a deployed install hands-off: no
 * step of this pipeline needs a developer's machine.
 *
 * Buckets are serialized one at a time and uploaded with a small amount of
 * concurrency; holding all 128 serialized bodies at once would be a needless
 * spike on top of the parsed artifact already in memory.
 */
interface BucketStore {
  upload(
    path: string,
    body: Blob,
    options: { contentType: string; cacheControl: string; upsert: boolean },
  ): Promise<{ error: { message: string } | null }>
}

async function uploadPlayerShards(
  store: BucketStore,
  artifact: { generatedAt: string; attribution?: string; methodology?: Record<string, string>; players: ShardablePlayer[] },
) {
  const { index, buckets } = buildPlayerShards(artifact)
  let next = 0
  let failure: string | null = null
  const worker = async () => {
    for (let i = next++; i < buckets.length && !failure; i = next++) {
      const entry = buckets[i]
      const payload = `${JSON.stringify(entry.body)}
`
      const { error } = await store.upload(entry.path, new Blob([payload], { type: 'application/json' }), {
        contentType: 'application/json', cacheControl: '300', upsert: true,
      })
      if (error) { failure = `${entry.path}: ${error.message}`; return }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (failure) throw new Error(`Shard upload failed at ${failure}`)

  // The index is written last, on purpose. It is what points the client at a
  // bucket, so publishing it only after every bucket is in place means a
  // partial run can never advertise records that are not there yet.
  const { error: indexError } = await store.upload(SHARD_INDEX_PATH, new Blob([`${JSON.stringify(index)}
`], { type: 'application/json' }), {
    contentType: 'application/json', cacheControl: '300', upsert: true,
  })
  if (indexError) throw new Error(`Shard index upload failed: ${indexError.message}`)
  return { shards: buckets.length, players: index.players.length }
}

async function downloadText(url: string, optional = false) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(90_000) })
  if (response.status === 404 && optional) return null
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  return await response.text()
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expected = Deno.env.get('RANKINGS_CRON_SECRET')
  if (!expected || request.headers.get('x-cron-secret') !== expected) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase runtime credentials are unavailable' }, 500)
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const requested = await request.json().catch(() => ({})) as { trigger?: string }
  const trigger = requested.trigger === 'manual' ? 'manual' : 'cron'
  const { data: run, error: runError } = await client.from('intelligence_sync_runs').insert({ trigger_source: trigger, status: 'running' }).select('id').single()
  if (runError) return json({ error: runError.message }, 500)

  try {
    const generatedAt = new Date().toISOString()
    const currentYear = new Date().getUTCFullYear()
    const [{ data: stored, error: downloadError }, scheduleCsv, weeklyCsv] = await Promise.all([
      client.storage.from(bucket).download(objectPath),
      downloadText(SCHEDULE_URL),
      downloadText(weeklyStatsUrl(currentYear), true),
    ])
    if (downloadError || !stored) throw new Error(downloadError?.message ?? `Missing ${bucket}/${objectPath}. Run npm run sync:intelligence && npm run upload:supabase first.`)
    const artifact = JSON.parse(await stored.text()) as PublishedIntelligence
    const extraObservations = weeklyCsv ? observationsFromWeeklyCsv(weeklyCsv, currentYear) : []
    const refreshed = refreshPublishedSchedule({
      artifact,
      games: gamesFromCsv(scheduleCsv ?? ''),
      currentYear,
      generatedAt,
      extraObservations,
    })
    const body = `${JSON.stringify(refreshed.artifact)}\n`
    const scheduleBody = `${JSON.stringify(publishedScheduleArtifact(refreshed.artifact))}\n`
    const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, new Blob([body], { type: 'application/json' }), {
      contentType: 'application/json',
      cacheControl: '300',
      upsert: true,
    })
    if (uploadError) throw uploadError
    const { error: scheduleUploadError } = await client.storage.from(bucket).upload(schedulePath, new Blob([scheduleBody], { type: 'application/json' }), {
      contentType: 'application/json',
      cacheControl: '300',
      upsert: true,
    })
    if (scheduleUploadError) throw scheduleUploadError
    const shards = await uploadPlayerShards(client.storage.from(bucket), refreshed.artifact)
    const { error: metadataError } = await client.from('data_artifacts').upsert({
      kind: 'player-intelligence',
      bucket,
      object_path: objectPath,
      schema_version: 1,
      generated_at: generatedAt,
      byte_size: body.length,
      metadata: { source: 'cron', ...refreshed.stats, ...shards },
    })
    if (metadataError) throw metadataError
    const stats = { ...refreshed.stats, ...shards }
    await client.from('intelligence_sync_runs').update({ status: 'succeeded', finished_at: new Date().toISOString(), stats }).eq('id', run.id)
    return json({ runId: run.id, status: 'succeeded', stats })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await client.from('intelligence_sync_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message }).eq('id', run.id)
    return json({ runId: run.id, status: 'failed', error: message }, 500)
  }
})
