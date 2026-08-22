import { useEffect, useRef } from 'react'
import type { DraftPick } from '../providers/types'

export function pickIdentity(pick: Pick<DraftPick, 'pickNo' | 'playerId'>): string {
  return `${pick.pickNo}:${pick.playerId}`
}

export function addedPickCount(
  previous: Set<string> | null,
  picks: Array<Pick<DraftPick, 'pickNo' | 'playerId'>>,
): { next: Set<string>; added: number } {
  const next = new Set(picks.map(pickIdentity))
  if (!previous) return { next, added: 0 }
  let added = 0
  for (const key of next) if (!previous.has(key)) added += 1
  return { next, added }
}

type WindowWithAudio = Window & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

let audio: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audio) return audio
  const Ctor = (window as WindowWithAudio).AudioContext ?? (window as WindowWithAudio).webkitAudioContext
  if (!Ctor) return null
  audio = new Ctor()
  return audio
}

export function unlockDraftSounds() {
  const ctx = audioContext()
  if (ctx?.state === 'suspended') void ctx.resume()
}

function beep(
  ctx: AudioContext,
  {
    frequency,
    start,
    duration,
    gain,
    type = 'sine',
  }: {
    frequency: number
    start: number
    duration: number
    gain: number
    type?: OscillatorType
  },
) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, start)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Soft tick for someone else coming off the board. */
function withAudio(play: (ctx: AudioContext) => void) {
  const ctx = audioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume().then(() => {
      if (audio?.state === 'running') play(audio)
    })
    return
  }
  play(ctx)
}

/** Soft tick for someone else coming off the board. */
export function playPickSound() {
  withAudio((ctx) => {
    const at = ctx.currentTime
    beep(ctx, { frequency: 720, start: at, duration: 0.07, gain: 0.055, type: 'triangle' })
    beep(ctx, { frequency: 480, start: at, duration: 0.09, gain: 0.03, type: 'sine' })
  })
}

/** Sharper three-note cue when your seat is on the clock. */
export function playOnClockSound() {
  withAudio((ctx) => {
    const at = ctx.currentTime
    beep(ctx, { frequency: 523, start: at, duration: 0.12, gain: 0.09, type: 'triangle' })
    beep(ctx, { frequency: 659, start: at + 0.11, duration: 0.12, gain: 0.1, type: 'triangle' })
    beep(ctx, { frequency: 784, start: at + 0.22, duration: 0.18, gain: 0.12, type: 'triangle' })
  })
}

const CATCH_UP = 5

export function useDraftSounds({
  draftKey,
  picks,
  youAreOnClock,
  enabled,
  primed,
}: {
  draftKey: string
  picks: DraftPick[]
  youAreOnClock: boolean
  enabled: boolean
  primed: boolean
}) {
  const seen = useRef<Set<string> | null>(null)
  const clockArmed = useRef(false)
  const wasOnClock = useRef(false)

  useEffect(() => {
    seen.current = null
    clockArmed.current = false
    wasOnClock.current = false
  }, [draftKey])

  useEffect(() => {
    const unlock = () => unlockDraftSounds()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (!primed) return
    const { next, added } = addedPickCount(seen.current, picks)
    const firstLook = seen.current == null
    seen.current = next

    if (firstLook) {
      clockArmed.current = true
      wasOnClock.current = youAreOnClock
      if (enabled && youAreOnClock) playOnClockSound()
      return
    }

    if (enabled && added > 0) {
      const count = added >= CATCH_UP ? 1 : added
      for (let index = 0; index < count; index += 1) {
        window.setTimeout(playPickSound, index * 90)
      }
    }

    if (!clockArmed.current) {
      clockArmed.current = true
      wasOnClock.current = youAreOnClock
      return
    }
    if (enabled && youAreOnClock && !wasOnClock.current) {
      window.setTimeout(playOnClockSound, added > 0 ? 200 : 0)
    }
    wasOnClock.current = youAreOnClock
  }, [enabled, picks, primed, youAreOnClock])
}
