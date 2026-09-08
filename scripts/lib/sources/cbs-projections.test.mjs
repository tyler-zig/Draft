import { describe, expect, it } from 'vitest'
import { boardUrl, parseBoard } from './cbs-projections.mjs'

const rbHtml = `
<table><tr class="TableBase-bodyTr">
<td><span class="CellPlayerName--long"><span class="">
<a href="/nfl/players/3162723/jahmyr-gibbs/fantasy/" class="">Jahmyr Gibbs</a>
<span class="CellPlayerName-position">RB</span>
<span class="CellPlayerName-team">DET</span>
</span></span></td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">17</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">261</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">1349</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">5.2</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">12</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">80</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">70</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">540</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">31.8</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">7.7</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">4</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">1.1</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">320</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">18.8</td>
</tr></table>
`

const dstHtml = `
<table><tr class="TableBase-bodyTr">
<td><span class="TeamName"><a href="/nfl/teams/SEA/seattle-seahawks/">Seattle</a></span></td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">17</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">1</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">48</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">900</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">10</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">12</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">3</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">255</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">15</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">3200</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">1600</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">4800</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">282</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">110</td>
<td class="TableBase-bodyTd TableBase-bodyTd--number">6.5</td>
</tr></table>
`

describe('boardUrl', () => {
  it('reads the rest-of-season board, not the week-1 /season/ slug', () => {
    expect(boardUrl('RB', 2026)).toBe('https://www.cbssports.com/fantasy/football/stats/RB/2026/restofseason/projections/ppr/')
    expect(boardUrl('DEF', 2026)).toBe('https://www.cbssports.com/fantasy/football/stats/DST/2026/restofseason/projections/ppr/')
  })
})

describe('parseBoard', () => {
  it('reads a running-back volume line from TableBase cells', () => {
    const [row] = parseBoard(rbHtml, 'RB')
    expect(row).toMatchObject({
      name: 'Jahmyr Gibbs',
      team: 'DET',
      position: 'RB',
      games: 17,
      cbsId: '3162723',
      stats: {
        rush_att: 261,
        rush_yd: 1349,
        rush_td: 12,
        rec_tgt: 80,
        rec: 70,
        rec_yd: 540,
        rec_td: 4,
        fum_lost: 1.1,
      },
    })
  })

  it('keys a DST on the team abbreviation', () => {
    const [row] = parseBoard(dstHtml, 'DST')
    expect(row).toMatchObject({
      name: 'SEA D/ST',
      team: 'SEA',
      position: 'DEF',
      stats: { int: 17, sack: 48, pts_allow: 255 },
    })
  })
})
