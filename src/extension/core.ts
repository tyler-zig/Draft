/**
 * The draft logic the Chrome extension shares with the app.
 *
 * The overlay used to carry its own copy of all of this -- snake math, ESPN
 * snapshot mapping, roster needs, and a simplified scorer -- because it has to
 * answer the moment a pick lands and cannot wait for the app to poll. Two
 * implementations meant every fix landed twice, and they drifted: a draft-order
 * bug had to be found and fixed separately in each.
 *
 * So the volatile half stays local to the extension and the slow half comes
 * from the app: the overlay reads picks and board order straight from the live
 * ESPN snapshot, and joins them against a valuation table the app publishes
 * (see `playerValuations`), which barely changes during a draft. Same code,
 * same numbers, no waiting.
 *
 * `npm run build:extension` bundles this to `extension/core.bundle.js` as an
 * IIFE exposing `globalThis.DraftAssistantCore`.
 */
export { mapEspnSession, mapEspnPicks, mapEspnPlayers, espnSnapshotPickStamp } from '../espn/mapEspn'
export { nextOpenPickNumber, nextPickNumberForSlot, ownerSlotForPick, picksUntilSlot } from '../draft/snake'
export { occupiedPickNumbers } from '../draft/pickSlots'
export { recommendPicks, suggestionSet } from '../draft/recommend'
export { suggestionGlance } from '../draft/playerContext'
export { overlayRoom } from './overlayRoom'
export { applyValuations, buildValuations } from './playerValuations'
export type { PlayerValuation, ValuationTable } from './playerValuations'
