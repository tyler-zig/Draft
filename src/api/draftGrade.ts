import type { AiDraftBriefing, AiDraftGrade } from '../draft/aiGrade'
import { parseAiDraftGrade } from '../draft/aiGrade'
import { supabase } from '../supabase/client'

export class DraftGradeError extends Error {
  readonly code: 'unavailable' | 'failed'

  constructor(message: string, code: 'unavailable' | 'failed' = 'failed') {
    super(message)
    this.name = 'DraftGradeError'
    this.code = code
  }
}

function messageFrom(error: { message?: string } | null, data: unknown): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const body = (data as { error?: unknown }).error
    if (typeof body === 'string' && body.trim()) return body
  }
  if (error?.message && !/non-2xx/i.test(error.message)) return error.message
  return 'DeepSeek could not grade this draft.'
}

/**
 * Send the packed briefing to the `grade-draft` function, which is the only
 * place that holds a DeepSeek key.
 */
export async function requestAiDraftGrade(briefing: AiDraftBriefing): Promise<AiDraftGrade> {
  if (!supabase) {
    throw new DraftGradeError(
      'AI grades need Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      'unavailable',
    )
  }
  const { data, error } = await supabase.functions.invoke('grade-draft', {
    body: { briefing },
  })
  if (error) throw new DraftGradeError(messageFrom(error, data))
  try {
    return parseAiDraftGrade(data)
  } catch (cause) {
    throw new DraftGradeError(cause instanceof Error ? cause.message : 'AI reply was unreadable')
  }
}
