const statusEl = document.getElementById('status')
const openEspnBtn = document.getElementById('open-espn')
const openYahooBtn = document.getElementById('open-yahoo')
const openNflBtn = document.getElementById('open-nfl')
const openBtn = document.getElementById('open-app')
const scrapeBtn = document.getElementById('scrape-rankings')
const scrapeAllBtn = document.getElementById('scrape-all-rankings')

chrome.runtime.sendMessage({ type: 'GET_ESPN_SNAPSHOT' }, (snapshot) => {
  if (snapshot?.league) {
    const name = snapshot.league?.settings?.name || `League ${snapshot.leagueId}`
    statusEl.textContent = `Syncing ${name}`
    statusEl.className = 'ok'
    return
  }
  if (snapshot?.error) {
    statusEl.textContent = snapshot.error
    statusEl.className = 'warn'
    return
  }
  if (snapshot?.leagueId) {
    statusEl.textContent = `Found league ${snapshot.leagueId}. Keep that ESPN tab open.`
    statusEl.className = 'ok'
    return
  }
  statusEl.textContent = 'Open your ESPN team page, then keep that tab open.'
  statusEl.className = 'warn'
})

openEspnBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_ESPN' }, () => {
    statusEl.textContent = 'Opened ESPN Fantasy. Pick a league, then come back here.'
    statusEl.className = 'ok'
  })
})

openYahooBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SITE', provider: 'yahoo' }, () => {
    statusEl.textContent = 'Opened Yahoo Fantasy. Pick a league, then come back here.'
    statusEl.className = 'ok'
  })
})

openNflBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SITE', provider: 'nfl' }, () => {
    statusEl.textContent = 'Opened NFL Fantasy. Pick a league, then come back here.'
    statusEl.className = 'ok'
  })
})

openBtn.addEventListener('click', async () => {
  // Prefer a tab that is already open -- localhost on any Vite port, or the
  // hosted Vercel deploy -- before assuming the local default.
  const stored = await chrome.storage.local.get('appOrigins')
  const extras = Array.isArray(stored.appOrigins) ? stored.appOrigins : []
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find((tab) => tab.url && isAppTab(tab.url, extras))
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true })
      } catch {
        /* ignore */
      }
    }
    return
  }
  await chrome.tabs.create({ url: extras[0] ? `${extras[0]}/` : DEFAULT_APP_URL })
})

scrapeBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SCRAPE_CURRENT_RANKINGS' }, (result) => {
    statusEl.textContent = result?.ok ? `Scraped ${result.count} rankings. Open the draft room and add it.` : (result?.error || 'Could not scrape this page.')
    statusEl.className = result?.ok ? 'ok' : 'warn'
  })
})

scrapeAllBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SCRAPE_OPEN_RANKINGS' }, (result) => {
    statusEl.textContent = result?.ok ? `Scraped ${result.count} rankings from open source tabs.` : 'No supported rankings tabs are open.'
    statusEl.className = result?.ok ? 'ok' : 'warn'
  })
})
