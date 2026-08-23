import { describe, expect, it } from 'vitest'
import { projectionBreakdownRows, projectionBreakdownText } from './projectionBreakdown'

const breakdown = [
  { id: 'cbs', label: 'CBS', stats: { rush_yd: 1349 }, games: 17, points: 348.2 },
  { id: 'espn', label: 'ESPN', stats: { rush_yd: 1373 }, games: 17, points: 364.9 },
]

describe('projectionBreakdownRows', () => {
  it('lists consensus then each source that has the picked stat', () => {
    expect(projectionBreakdownRows(353.5, breakdown, (line) => line.points)).toEqual([
      { label: 'Consensus', value: '353.5', consensus: true },
      { label: 'CBS', value: '348.2' },
      { label: 'ESPN', value: '364.9' },
    ])
    expect(projectionBreakdownRows(1251, breakdown, (line) => line.stats.rush_yd)).toEqual([
      { label: 'Consensus', value: '1251', consensus: true },
      { label: 'CBS', value: '1349' },
      { label: 'ESPN', value: '1373' },
    ])
  })

  it('omits sources that do not publish the picked stat', () => {
    expect(projectionBreakdownRows(70, breakdown, (line) => line.stats.rec)).toEqual([
      { label: 'Consensus', value: '70', consensus: true },
    ])
  })
})

describe('projectionBreakdownText', () => {
  it('prints one source per line for the native title', () => {
    expect(projectionBreakdownText(353.5, breakdown, (line) => line.points)).toBe('Consensus 353.5\nCBS 348.2\nESPN 364.9')
  })
})
