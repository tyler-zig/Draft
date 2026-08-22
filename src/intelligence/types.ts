export interface SourcedValue<T> {
  value: T | null
  source: string
  updatedAt: string
}

export interface RankHistoryPoint {
  date: string
  source: string
  rank: number | null
  adp: number | null
}

export interface WeeklyProjection {
  week: number
  opponent: string | null
  fantasyPoints: number | null
  carries: number | null
  targets: number | null
  source: string
}

export interface PlayerIntelligenceRecord {
  playerId: string
  season: number
  identity: {
    age: SourcedValue<number>
    height: SourcedValue<string>
    weight: SourcedValue<number>
    depthChartOrder: SourcedValue<number>
  }
  market: {
    adp: SourcedValue<number>
    consensusRank: SourcedValue<number>
    rankLow: number | null
    rankHigh: number | null
    history: RankHistoryPoint[]
  }
  projections: {
    seasonPoints: SourcedValue<number>
    carries: SourcedValue<number>
    targets: SourcedValue<number>
    pointsPerGame: SourcedValue<number>
    weekly: WeeklyProjection[]
  }
  usage: {
    touchShare: SourcedValue<number>
    redZoneTouchShare: SourcedValue<number>
    snapShare: SourcedValue<number>
  }
  durability: {
    gamesMissedLastTwoSeasons: SourcedValue<number>
    currentStatus: SourcedValue<string>
    riskScore: SourcedValue<number>
  }
  schedule: Array<{ week: number; opponent: string | null; home: boolean; bye?: boolean; matchupRank: number | null }>
  analystNote: { text: string | null; generated: boolean; generatedAt: string | null }
  updatedAt: string
}
