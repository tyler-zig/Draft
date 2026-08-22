import { demoProvider } from './demoProvider'
import { espnProvider } from './espnProvider'
import { nflProvider } from './nflProvider'
import { sleeperProvider } from './sleeperProvider'
import { yahooProvider } from './yahooProvider'
import type { DraftProvider, ProviderId } from './types'

export function getProvider(id: string): DraftProvider {
  switch (id as ProviderId) {
    case 'sleeper':
      return sleeperProvider
    case 'demo':
      return demoProvider
    case 'espn':
      return espnProvider
    case 'yahoo':
      return yahooProvider
    case 'nfl':
      return nflProvider
    default:
      throw new Error(`Unknown draft provider: ${id}`)
  }
}

export { demoProvider, espnProvider, nflProvider, sleeperProvider, yahooProvider }
export type { DraftProvider, ProviderId }
