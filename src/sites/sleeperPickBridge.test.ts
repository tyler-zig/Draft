import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestSleeperPick } from './sleeperPickBridge'
import { SITE_APP_SOURCE, SITE_BRIDGE_SOURCE } from './types'

function postedRequests() {
  return (window.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((data) => data?.source === SITE_APP_SOURCE && data.type === 'SLEEPER_DRAFT_PICK')
}

function answer(requestId: unknown, payload: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: { source: SITE_BRIDGE_SOURCE, type: 'SLEEPER_DRAFT_PICK_RESULT', requestId, ...payload },
  }))
}

describe('requestSleeperPick', () => {
  beforeEach(() => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('sends the pick intent and resolves with the extension result', async () => {
    const pending = requestSleeperPick({ draftId: '42', playerId: '7564', pickNo: 13 })
    const [request] = postedRequests()
    expect(request).toMatchObject({ draftId: '42', playerId: '7564', pickNo: 13 })
    answer(request.requestId, { ok: true, pickNo: 13 })
    await expect(pending).resolves.toMatchObject({ ok: true })
  })

  it('surfaces the reason a pick was rejected', async () => {
    const pending = requestSleeperPick({ draftId: '42', playerId: '7564', pickNo: 13 })
    answer(postedRequests()[0].requestId, { ok: false, error: 'Not your pick.' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'Not your pick.' })
  })

  // Two picks in flight must not cross: resolving the wrong promise would tell
  // the room a pick landed when a different one did.
  it('matches answers to their own request', async () => {
    const first = requestSleeperPick({ draftId: '42', playerId: 'a', pickNo: 1 })
    const second = requestSleeperPick({ draftId: '42', playerId: 'b', pickNo: 2 })
    const [reqA, reqB] = postedRequests()
    expect(reqA.requestId).not.toBe(reqB.requestId)
    answer(reqB.requestId, { ok: true })
    answer(reqA.requestId, { ok: false, error: 'stale' })
    await expect(second).resolves.toMatchObject({ ok: true })
    await expect(first).resolves.toMatchObject({ ok: false, error: 'stale' })
  })

  it('ignores a stray message with no matching request', async () => {
    const pending = requestSleeperPick({ draftId: '42', playerId: '7564', pickNo: 13 })
    answer('someone-elses-id', { ok: true })
    answer(postedRequests()[0].requestId, { ok: false, error: 'real answer' })
    await expect(pending).resolves.toMatchObject({ error: 'real answer' })
  })

  // A timeout cannot distinguish "never sent" from "Sleeper accepted it", so
  // the copy must not claim the pick failed.
  it('times out without asserting the pick failed', async () => {
    vi.useFakeTimers()
    const pending = requestSleeperPick({ draftId: '42', playerId: '7564', pickNo: 13 })
    vi.advanceTimersByTime(12_000)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/check the sleeper board/i)
  })
})
