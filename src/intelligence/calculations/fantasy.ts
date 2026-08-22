export interface FantasyStatLine {
  passingYards?: number
  passingTds?: number
  interceptions?: number
  rushingYards?: number
  rushingTds?: number
  receptions?: number
  receivingYards?: number
  receivingTds?: number
  fumblesLost?: number
  twoPointConversions?: number
}

export function calculateFantasyPoints(line: FantasyStatLine, receptionPoints: 0 | 0.5 | 1) {
  return (line.passingYards ?? 0) * 0.04
    + (line.passingTds ?? 0) * 4
    - (line.interceptions ?? 0) * 2
    + (line.rushingYards ?? 0) * 0.1
    + (line.rushingTds ?? 0) * 6
    + (line.receptions ?? 0) * receptionPoints
    + (line.receivingYards ?? 0) * 0.1
    + (line.receivingTds ?? 0) * 6
    - (line.fumblesLost ?? 0) * 2
    + (line.twoPointConversions ?? 0) * 2
}
