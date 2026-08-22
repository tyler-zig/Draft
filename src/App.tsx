import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ConnectPage } from './pages/ConnectPage'
import { DraftRoom } from './pages/DraftRoom'
import { PlayerIntelligence } from './pages/PlayerIntelligence'
import { listenForEspnExtension } from './espn/bridge'
import { listenForSiteExtension } from './sites/bridge'
import { ingestScrapedRankings } from './rankings/bridge'

export default function App() {
  useEffect(() => {
    const stopEspn = listenForEspnExtension()
    const stopSites = listenForSiteExtension()
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) ingestScrapedRankings(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => {
      stopEspn()
      stopSites()
      window.removeEventListener('message', onMessage)
    }
  }, [])

  return (
    <Routes>
      <Route path="/" element={<ConnectPage />} />
      <Route path="/draft/:providerId/:draftId" element={<DraftRoom />} />
      <Route path="/players" element={<PlayerIntelligence />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
