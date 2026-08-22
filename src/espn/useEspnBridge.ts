import { useEffect, useState } from 'react'
import {
  getEspnSnapshot,
  isEspnBridgeHydrated,
  isEspnExtensionInstalled,
  listenForEspnExtension,
  requestEspnSnapshot,
  subscribeEspnBridge,
} from './bridge'
import type { EspnSnapshot } from './mapEspn'

export function useEspnBridge() {
  const [installed, setInstalled] = useState(isEspnExtensionInstalled)
  const [hydrated, setHydrated] = useState(isEspnBridgeHydrated)
  const [snapshot, setSnapshot] = useState<EspnSnapshot | null>(getEspnSnapshot)

  useEffect(() => {
    const stopListen = listenForEspnExtension()
    const unsub = subscribeEspnBridge(() => {
      setInstalled(isEspnExtensionInstalled())
      setHydrated(isEspnBridgeHydrated())
      setSnapshot(getEspnSnapshot())
    })
    // Retry because MV3 service workers and bfcache restores can race the
    // content script's one-time startup request.
    requestEspnSnapshot()
    const retry = window.setTimeout(requestEspnSnapshot, 500)
    return () => {
      window.clearTimeout(retry)
      stopListen()
      unsub()
    }
  }, [])

  return { installed, hydrated, snapshot, refresh: requestEspnSnapshot }
}
