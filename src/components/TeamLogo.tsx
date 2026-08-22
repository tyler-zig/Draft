import { useEffect, useState } from 'react'

export function teamInitials(label?: string) {
  const words = (label ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return (words[0] ?? 'TM').slice(0, 2).toUpperCase()
}

export function TeamLogo({
  src,
  label,
  className = '',
  decorative = false,
}: {
  src?: string | null
  label?: string
  className?: string
  decorative?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  const classes = `cc-team-logo ${className}`.trim()
  if (!src || failed) {
    return (
      <span className={`${classes} cc-team-logo-fallback`} title={label} aria-hidden={decorative || !label}>
        {teamInitials(label)}
      </span>
    )
  }
  return (
    <img
      className={classes}
      src={src}
      alt={decorative ? '' : label ?? ''}
      title={label}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
