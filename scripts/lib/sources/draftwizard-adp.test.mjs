import { describe, expect, it } from 'vitest'
import { __test__ } from './draftwizard-adp.mjs'

const { draftWizardAdpSetId, draftWizardAdpUrl, overallPickFromRoundPick, parseDraftWizardAdp, LIVE_ADP_FORMATS } = __test__

const TABLE = `
<table id="adpTable" class="tablesorter">
  <thead><tr><th>Position</th><th>Overall</th><th>Player</th><th>Team (Bye)</th><th>Avg Pick</th><th>High</th><th>Low</th><th>Std Dev</th><th>% Drafted</th></tr></thead>
  <tbody>
    <tr class="PosRB">
      <td>RB1</td>
      <td>1</td>
      <td class="playerName"><a href="https://www.fantasypros.com/nfl/players/jahmyr-gibbs.php">Jahmyr Gibbs</a></td>
      <td>DET  <span class="ByeWeek">(6)</span></td>
      <td>1.02</td>
      <td>1.01</td>
      <td>1.07</td>
      <td>0.83</td>
      <td>100%</td>
    </tr>
    <tr class="PosRB">
      <td>RB38</td>
      <td>101</td>
      <td class="playerName"><a href="https://www.fantasypros.com/nfl/players/blake-corum.php">Blake Corum</a></td>
      <td>LAR  <span class="ByeWeek">(11)</span></td>
      <td>9.07</td>
      <td>7.01</td>
      <td>27.00</td>
      <td>18.51</td>
      <td>99%</td>
    </tr>
    <tr class="PosDST">
      <td>DST1</td>
      <td>121</td>
      <td class="playerName"><a href="https://www.fantasypros.com/nfl/players/houston-defense.php">Houston Texans</a></td>
      <td>HOU  <span class="ByeWeek">(8)</span></td>
      <td>11.06</td>
      <td>5.06</td>
      <td>27.00</td>
      <td>56.30</td>
      <td>92%</td>
    </tr>
  </tbody>
</table>
`

describe('overallPickFromRoundPick', () => {
  it('converts Draft Wizard round.pick into an overall pick', () => {
    expect(overallPickFromRoundPick(1.01, 12)).toBe(1)
    expect(overallPickFromRoundPick(1.02, 12)).toBe(2)
    expect(overallPickFromRoundPick(9.07, 12)).toBe(103)
    expect(overallPickFromRoundPick(11.06, 12)).toBe(126)
    expect(overallPickFromRoundPick(4.01, 10)).toBe(31)
    expect(overallPickFromRoundPick(4.01, 14)).toBe(43)
  })

  it('treats a missing hundredths slot as the first pick of that round', () => {
    expect(overallPickFromRoundPick(12.0, 10)).toBe(111)
    expect(overallPickFromRoundPick(2.0, 8)).toBe(9)
  })

  it('drops empty or invalid values', () => {
    expect(overallPickFromRoundPick(0, 12)).toBeNull()
    expect(overallPickFromRoundPick(1.02, 0)).toBeNull()
  })
})

describe('parseDraftWizardAdp', () => {
  it('reads name, team, position and converts Avg Pick for that league size', () => {
    const rows = parseDraftWizardAdp(TABLE, 12)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      name: 'Jahmyr Gibbs',
      team: 'DET',
      position: 'RB',
      overall: 1,
      adp: 2,
      byeWeek: 6,
      positionRank: 'RB1',
      fantasyProsSlug: 'jahmyr-gibbs',
    })
    expect(rows[1]).toMatchObject({ name: 'Blake Corum', adp: 103, stdDev: 18.51 })
    expect(rows[2]).toMatchObject({ name: 'Houston Texans', team: 'HOU', position: 'DEF', adp: 126 })
  })

  it('uses the requested team count so the same printed pick moves in a smaller room', () => {
    const ten = parseDraftWizardAdp(TABLE, 10)
    expect(ten[1]?.adp).toBe(87)
    expect(ten[2]?.adp).toBe(106)
  })

  it('returns nothing without the ADP table', () => {
    expect(parseDraftWizardAdp('<html></html>', 12)).toEqual([])
  })
})

describe('board urls', () => {
  it('builds the size-specific Draft Wizard path', () => {
    expect(draftWizardAdpSetId(10)).toBe('draftwizard-adp-10')
    expect(draftWizardAdpUrl(14)).toBe(
      'https://draftwizard.fantasypros.com/football/adp/mock-drafts/overall/default-half-14-teams',
    )
  })

  it('keeps half-PPR ids stable and suffixes the other formats', () => {
    expect(draftWizardAdpSetId(12, 'half')).toBe('draftwizard-adp-12')
    expect(draftWizardAdpSetId(12, 'ppr')).toBe('draftwizard-adp-ppr-12')
    expect(draftWizardAdpSetId(10, 'std')).toBe('draftwizard-adp-std-10')
    expect(draftWizardAdpSetId(8, 'rookie')).toBe('draftwizard-adp-rookie-8')
    expect(draftWizardAdpUrl(12, 'ppr')).toBe(
      'https://draftwizard.fantasypros.com/football/adp/mock-drafts/overall/default-ppr-12-teams',
    )
    expect(draftWizardAdpUrl(10, 'rookie')).toBe(
      'https://draftwizard.fantasypros.com/football/adp/mock-drafts/overall/default-rookie-10-teams',
    )
    expect(LIVE_ADP_FORMATS.map((format) => format.slug)).toEqual(['half', 'ppr', 'std', 'rookie'])
  })
})
