import { describe, expect, it } from 'vitest'
import { parseCsv, toRow } from './fantasysharks-projections.mjs'

const qbCsv = `Rank,Player ID,Player Name,Team,Position,Att,Comp,Pass Yds,Pass TDs,Int,Rush,Rush Yds,Rush TDs,Fum Lost,Pts
1,13589,"Allen, Josh",BUF,QB,450.1,303.8,3601.0,31.1,8.5,106.9,514.0,12.8,3.0,422.2
`

const rbCsv = `Rank,Player ID,Player Name,Team,Position,Rush,Rush Yds,Rush TDs,Tgt,Rec,Rec Yds,Rec TDs,Fum Lost,Pts
1,16161,"Robinson, Bijan",ATL,RB,293.9,1451.0,10.6,92.3,69.7,635.0,2.8,1.8,357.2
`

const defCsv = `Rank,Player ID,Player Name,Team,Position,Yds Allowed,Pts Agn,Scks,Int,Fum,DefTD,Safts,Pts
1,515,"Seahawks, Seattle",SEA,D,4840.8,255.5,48.8,17.2,9.6,8.2,0.0,231.9
`

const kCsv = `Rank,Player ID,Player Name,Team,Position,XP,XPA,FG,Att,Pts
1,12860,"Fairbairn, Ka'imi",HOU,K,30.0,32.2,40.8,46.3,164.7
`

describe('parseCsv', () => {
  it('maps a QB row onto pass/rush volume and flips the name', () => {
    const [row] = parseCsv(qbCsv, 'QB')
    expect(row).toMatchObject({
      name: 'Josh Allen',
      team: 'BUF',
      position: 'QB',
      fantasySharksId: '13589',
      stats: {
        pass_att: 450.1,
        pass_cmp: 303.8,
        pass_yd: 3601,
        pass_td: 31.1,
        pass_int: 8.5,
        rush_att: 106.9,
        rush_yd: 514,
        rush_td: 12.8,
        fum_lost: 3,
      },
    })
  })

  it('maps a back without treating Rush as pass attempts', () => {
    const [row] = parseCsv(rbCsv, 'RB')
    expect(row.name).toBe('Bijan Robinson')
    expect(row.stats.rush_yd).toBe(1451)
    expect(row.stats.rec).toBe(69.7)
    expect(row.stats.pass_att).toBeUndefined()
  })

  it('keys a defense on the team and maps sack / points allowed', () => {
    const [row] = parseCsv(defCsv, 'DEF')
    expect(row).toMatchObject({
      name: 'SEA D/ST',
      team: 'SEA',
      position: 'DEF',
      stats: { sack: 48.8, int: 17.2, fum_rec: 9.6, def_td: 8.2, pts_allow: 255.5 },
    })
  })

  it('maps kicker XP / FG / Att', () => {
    const [row] = parseCsv(kCsv, 'K')
    expect(row).toMatchObject({
      name: "Ka'imi Fairbairn",
      position: 'K',
      stats: { xpm: 30, fgm: 40.8, fga: 46.3 },
    })
  })
})

describe('toRow', () => {
  it('drops a row with no volume', () => {
    expect(toRow({ 'Player Name': 'Nobody', Team: 'CHI', Position: 'RB' }, 'RB')).toBeNull()
  })
})
