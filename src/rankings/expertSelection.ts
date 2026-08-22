import { EXPERT_PREFIX, type ExpertScoring } from './experts'

export const FANTASYPROS_CONSENSUS_PREFIX = 'collected:fantasypros-'

export function fantasyProsConsensusId(scoring: ExpertScoring): string {
  return `${FANTASYPROS_CONSENSUS_PREFIX}${scoring}`
}

/** Replace only the managed FantasyPros source; unrelated enabled lists survive. */
export function replaceFantasyProsSource(enabledIds: string[], nextIds: string[]): string[] {
  const kept = enabledIds.filter((id) => !id.startsWith(EXPERT_PREFIX) && !id.startsWith(FANTASYPROS_CONSENSUS_PREFIX))
  return [...new Set([...kept, ...nextIds])]
}

export function installedExpertSlugs(enabledIds: string[], scoring: ExpertScoring): string[] {
  const prefix = `${EXPERT_PREFIX}${scoring}:`
  return enabledIds.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length))
}

export function isFantasyProsSource(id: string): boolean {
  return id.startsWith(EXPERT_PREFIX) || id.startsWith(FANTASYPROS_CONSENSUS_PREFIX)
}
