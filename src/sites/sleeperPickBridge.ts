import { SITE_APP_SOURCE, SITE_BRIDGE_SOURCE } from './types'

/**
 * Asks the extension to submit a Sleeper pick.
 *
 * Unlike the snapshot bridges this is a request/response, so every call
 * carries a `requestId` and resolves exactly once. The app never sees a
 * Sleeper credential -- it sends an intent and reads an outcome. The write
 * itself happens in a logged-in sleeper.com tab (extension/sleeper-inject.js).
 */
export interface SleeperPickRequest {
  draftId: string
  playerId: string
  pickNo: number
}

export interface SleeperPickResult {
  ok: boolean
  error?: string | null
  pickNo?: number | null
}

/**
 * Long enough for a slow round trip through the service worker and Sleeper,
 * short enough that a wedged extension does not hold the button hostage while
 * the pick clock runs down.
 */
const PICK_TIMEOUT_MS = 12_000

let nextRequestId = 0

export function requestSleeperPick(request: SleeperPickRequest): Promise<SleeperPickResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'Picks can only be submitted from the browser.' })
  }
  return new Promise((resolve) => {
    const requestId = `app-pick-${Date.now()}-${nextRequestId++}`
    let settled = false

    const finish = (result: SleeperPickResult) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      resolve(result)
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return
      const data = event.data as Record<string, unknown> | null
      if (data?.source !== SITE_BRIDGE_SOURCE) return
      if (data.type !== 'SLEEPER_DRAFT_PICK_RESULT') return
      if (data.requestId !== requestId) return
      finish({
        ok: Boolean(data.ok),
        error: (data.error as string | null) ?? null,
        pickNo: (data.pickNo as number | null) ?? null,
      })
    }

    const timer = window.setTimeout(
      () => finish({
        ok: false,
        // Deliberately not "the pick failed": a timeout cannot tell a pick that
        // never left from one Sleeper accepted. Saying so would invite a double
        // pick on retry.
        error: 'No answer from the extension. Check the Sleeper board before picking again.',
      }),
      PICK_TIMEOUT_MS,
    )
    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        source: SITE_APP_SOURCE,
        type: 'SLEEPER_DRAFT_PICK',
        requestId,
        draftId: request.draftId,
        playerId: request.playerId,
        pickNo: request.pickNo,
      },
      '*',
    )
  })
}
