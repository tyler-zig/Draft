import { useEffect, useState } from 'react'
import { playerPhotoUrls, type PhotoPlayer } from '../draft/playerPhoto'

export function PlayerPhoto({
  player,
  className = '',
  variant = 'avatar',
  priority = false,
}: {
  player: PhotoPlayer
  className?: string
  variant?: 'avatar' | 'plain'
  priority?: boolean
}) {
  const urls = playerPhotoUrls(player)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(0)
  }, [player.id, player.espnId, player.sleeperId])
  const src = urls[index]
  const initials = `${player.firstName[0] ?? ''}${player.lastName[0] ?? ''}`.toUpperCase()
  const pos = `cc-${player.position.toLowerCase().replace('/', '')}`
  const classes = variant === 'avatar' ? `cc-avatar ${src ? 'cc-photo' : pos} ${className}` : className
  if (!src) return <span className={classes.trim()}>{initials || '·'}</span>
  return (
    <img
      className={classes.trim()}
      src={src}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      referrerPolicy="no-referrer"
      onError={() => setIndex((current) => current + 1)}
    />
  )
}
