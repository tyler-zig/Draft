import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSlotCounts } from '../providers/types'
import { AI_GRADE_LEGEND, type AiDraftBriefing } from '../draft/aiGrade'
import { DraftGradeError, requestAiDraftGrade } from './draftGrade'

const invoke = vi.fn()

vi.mock('../supabase/client', () => ({
  get supabase() { return state.client },
}))

const state: { client: { functions: { invoke: typeof invoke } } | null } = {
  client: { functions: { invoke } },
}

const briefing = {
  legend: AI_GRADE_LEGEND,
  league: {
    name: 'Mock', season: '2026', scoring: 'ppr', type: 'snake', teams: 4, rounds: 15,
    status: 'drafting', slots: defaultSlotCounts(), tePremium: null, playoffWeeks: null,
    yourSlot: 1, yourTeam: 'You',
  },
  progress: { picksMade: 4, picksTotal: 60, currentPick: 5, currentRound: 2, complete: false },
  runs: [],
  board: [],
  market: { byPosition: [], replacement: {}, steals: [], reaches: [] },
  remaining: { best: [], byPosition: [] },
  teams: [],
} satisfies AiDraftBriefing

describe('requestAiDraftGrade', () => {
  beforeEach(() => {
    invoke.mockReset()
    state.client = { functions: { invoke } }
  })

  it('returns a parsed writeup from the edge function', async () => {
    invoke.mockResolvedValue({
      data: { headline: 'Room take', summary: 'Value won.', themes: ['RB run'], teams: [] },
      error: null,
    })
    await expect(requestAiDraftGrade(briefing)).resolves.toEqual({
      headline: 'Room take',
      summary: 'Value won.',
      themes: ['RB run'],
      superlatives: [],
      teams: [],
    })
    expect(invoke).toHaveBeenCalledWith('grade-draft', { body: { briefing } })
  })

  it('prefers the function error body over the generic invoke message', async () => {
    invoke.mockResolvedValue({
      data: { error: 'DeepSeek is not configured on this project.' },
      error: { message: 'Edge Function returned a non-2xx status code' },
    })
    await expect(requestAiDraftGrade(briefing)).rejects.toMatchObject({
      name: 'DraftGradeError',
      message: 'DeepSeek is not configured on this project.',
      code: 'failed',
    })
  })

  it('fails clearly when Supabase is not configured', async () => {
    state.client = null
    await expect(requestAiDraftGrade(briefing)).rejects.toBeInstanceOf(DraftGradeError)
    await expect(requestAiDraftGrade(briefing)).rejects.toMatchObject({ code: 'unavailable' })
  })
})
