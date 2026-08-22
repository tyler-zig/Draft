function cellText(cell) {
  return (cell?.innerText || cell?.textContent || '').replace(/\s+/g, ' ').trim()
}

function position(value) {
  const match = value.match(/\b(QB|RB|WR|TE|K|DST|DEF)\b/i)
  return match ? (match[1].toUpperCase() === 'DEF' ? 'DST' : match[1].toUpperCase()) : null
}

function team(value) {
  const codes = value.match(/\b[A-Z]{2,3}\b/g) || []
  const code = [...codes].reverse().find((item) => !['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF'].includes(item))
  return code || null
}

function scrape() {
  const rows = []
  for (const tr of document.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('th, td')].map(cellText).filter(Boolean)
    if (cells.length < 2) continue
    const rank = Number((cells[0].match(/\d+/) || [])[0])
    if (!Number.isFinite(rank) || rank < 1 || rank > 1000) continue
    const joined = cells.join(' ')
    const pos = position(joined)
    if (!pos) continue
    const nameCell = cells.find((cell, index) => index > 0 && !position(cell) && !/^\$?\d+(\.\d+)?$/.test(cell))
    if (!nameCell) continue
    const name = nameCell.replace(/\b(QB|RB|WR|TE|K|DST|DEF)\b.*$/i, '').trim()
    if (name.length < 3 || /player|rank/i.test(name)) continue
    rows.push({ overall: rank, name, position: pos, team: team(joined) })
  }
  const unique = [...new Map(rows.map((row) => [`${row.overall}:${row.name}`, row])).values()]
  return {
    label: `${location.hostname.includes('cbssports') ? 'CBS Sports' : 'RotoWire'} scraped ${new Date().toLocaleString()}`,
    sourceUrl: location.href,
    fetchedAt: Date.now(),
    rows: unique,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SCRAPE_RANKINGS') return false
  const payload = scrape()
  chrome.runtime.sendMessage({ type: 'RANKINGS_SNAPSHOT', payload })
  sendResponse({ ok: payload.rows.length > 0, count: payload.rows.length, error: payload.rows.length ? undefined : 'No ranking rows found on this page.' })
  return false
})
