import { useEffect, useState } from 'react'
import {
  getSiteSnapshot,
  isSiteBridgeHydrated,
  isSiteExtensionInstalled,
  requestSiteSnapshot,
  subscribeSiteBridge,
} from './bridge'
import type { SiteProviderId } from './types'

export function useSiteBridge(provider: SiteProviderId) {
  const [installed, setInstalled] = useState(() => isSiteExtensionInstalled(provider))
  const [hydrated, setHydrated] = useState(() => isSiteBridgeHydrated(provider))
  const [snapshot, setSnapshot] = useState(() => getSiteSnapshot(provider))

  useEffect(() => {
    const unsub = subscribeSiteBridge(() => {
      setInstalled(isSiteExtensionInstalled(provider))
      setHydrated(isSiteBridgeHydrated(provider))
      setSnapshot(getSiteSnapshot(provider))
    })
    requestSiteSnapshot(provider)
    const retry = window.setTimeout(() => requestSiteSnapshot(provider), 500)
    return () => {
      window.clearTimeout(retry)
      unsub()
    }
  }, [provider])

  return { installed, hydrated, snapshot, refresh: () => requestSiteSnapshot(provider) }
}
