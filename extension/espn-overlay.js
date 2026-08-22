;(function (global) {
  const HOST_ID = 'draft-assistant-suggest-host'
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, Segoe UI, sans-serif; }
    .panel {
      position: fixed; top: 72px; right: 16px; z-index: 2147483646;
      width: 320px; color: #e8eef7; pointer-events: auto;
      background: #101820; border: 1px solid #2a3646; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.45);
      max-height: calc(100vh - 88px); display: flex; flex-direction: column;
    }
    .panel.wide { width: min(680px, calc(100vw - 24px)); }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px 8px; cursor: move; user-select: none;
    }
    .mark { color: #3ee0a0; font-weight: 800; }
    .title { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .clock { margin-left: auto; font-size: 11px; color: #8b9bb4; }
    .clock.on { color: #3ee0a0; font-weight: 700; }
    .btn {
      border: 0; background: transparent; color: #8b9bb4; cursor: pointer;
      width: 22px; height: 22px; border-radius: 6px; font-size: 14px; line-height: 1;
    }
    .btn:hover { background: #1b2633; color: #e8eef7; }
    .list { padding: 0 8px 8px; }
    .row {
      display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: start;
      width: 100%; margin: 0 0 4px; padding: 8px;
      border: 0; border-radius: 8px; background: #16202b; color: inherit; text-align: left; cursor: pointer;
    }
    .row:hover { background: #1d2a38; }
    .n { color: #8b9bb4; font-size: 11px; font-weight: 700; padding-top: 2px; }
    .who { min-width: 0; }
    .name { display: block; font-size: 13px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bits { display: block; color: #9fb0c7; font-size: 11px; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .sep { color: #5d6d82; }
    .up { color: #3ee0a0; }
    .down { color: #f0a3a3; }
    .why { display: block; color: #8b9bb4; font-size: 11px; margin-top: 2px; }
    .side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .pos { font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 999px; }
    .adp { font-size: 10px; font-weight: 700; color: #8b9bb4; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .adp.live { color: #7dd3fc; }
    .QB { background: #3b2060; color: #e9d5ff; }
    .RB { background: #064e3b; color: #6ee7b7; }
    .WR { background: #1e3a5f; color: #93c5fd; }
    .TE { background: #5b3d0d; color: #fcd34d; }
    .K, .DEF { background: #334155; color: #cbd5e1; }
    .empty, .note { padding: 8px 12px 12px; color: #8b9bb4; font-size: 12px; }
    .tabs { display: flex; gap: 2px; padding: 0 8px 6px; }
    .tab {
      border: 0; background: transparent; color: #8b9bb4; cursor: pointer;
      font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      padding: 5px 8px; border-radius: 6px;
    }
    .tab.on { background: #1d2a38; color: #e8eef7; }
    .needs { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px; }
    .need {
      font-size: 10px; font-weight: 700; padding: 3px 6px; border-radius: 999px;
      background: #16202b; color: #8b9bb4; font-variant-numeric: tabular-nums;
    }
    .need.high { background: #3f2a10; color: #fcd34d; }
    .need.med { background: #1e3a5f; color: #93c5fd; }
    .need.low { color: #5d6d82; }
    .body { overflow: auto; min-height: 0; }
    .slot {
      display: grid; grid-template-columns: 36px 1fr auto; gap: 8px; align-items: center;
      width: 100%; margin: 0 0 4px; padding: 6px 8px;
      border: 0; border-radius: 8px; background: #16202b; color: inherit; text-align: left;
    }
    button.slot { cursor: pointer; }
    button.slot:hover { background: #1d2a38; }
    .slot.open { color: #5d6d82; }
    .slot .lab { font-size: 10px; font-weight: 800; color: #8b9bb4; }
    .slot .nm { font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .board {
      display: grid; gap: 2px; padding: 0 8px 8px;
      overflow: auto; max-height: min(70vh, 640px);
    }
    .th, .rd { font-size: 9px; font-weight: 700; color: #8b9bb4; text-align: center; padding: 4px 0; }
    .th.you { color: #3ee0a0; }
    .cell {
      min-height: 34px; border-radius: 4px; background: #16202b;
      padding: 3px 4px; font-size: 9px; line-height: 1.2; text-align: left;
      overflow: hidden; color: inherit; border: 0; width: 100%;
    }
    button.cell { cursor: pointer; }
    button.cell:hover { filter: brightness(1.12); }
    .cell b { display: block; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cell small { display: block; color: #8b9bb4; }
    .cell.yours { box-shadow: inset 0 0 0 1px #3ee0a0; }
    .cell.current { background: #143528; color: #6ee7b7; }
    .cell.RB { background: #0b3328; }
    .cell.WR { background: #16324f; }
    .cell.TE { background: #3d2a0c; }
    .cell.QB { background: #2a1844; }
    .cell.K, .cell.DEF { background: #243041; }
    .mini { padding: 8px 10px; }
    .mini .head { padding: 0; cursor: pointer; }
  `

  let host = null
  let shadow = null
  let wrap = null
  let local = null
  let snapshot = null
  let valuations = null
  let collapsed = false
  let tab = 'picks'
  let pos = null

  function isDraftPath(pathname) {
    return /\/(?:football\/)?draft(?:\/|$)/i.test(pathname || location.pathname)
  }

  /**
   * One state, computed here.
   *
   * This used to reconcile locally-scored recs against a set the app pushed,
   * preferring the app's only while its `pickStamp` still matched the live
   * board -- which right after a pick it does not, so the overlay fell back to
   * a weaker local scorer exactly when it mattered. Now the app publishes its
   * player valuations instead of finished recs, and the overlay scores with
   * the same code the app runs, against a board that is never behind.
   */
  function active() {
    return local
  }

  function clockText(state) {
    if (!state) return ''
    if (state.youAreOnClock) return 'On the clock'
    if (state.until == null) return `Pick ${state.currentPickNo ?? '—'}`
    return `Your pick in ${state.until}`
  }

  function formatAdp(value) {
    return Number(value).toFixed(1)
  }

  /** Team · value vs the pick, or VORP when no market number exists. */
  function bitsHtml(rec) {
    const bits = []
    if (rec.team) bits.push(escapeHtml(rec.team))
    if (rec.vsPick != null) {
      const tone = rec.vsPick > 0 ? 'up' : rec.vsPick < 0 ? 'down' : ''
      const text = rec.vsPick > 0 ? `+${rec.vsPick}` : rec.vsPick === 0 ? 'even' : String(rec.vsPick)
      bits.push(`<span class="${tone}">${escapeHtml(text)}</span>`)
    } else if (rec.vorp != null) {
      const tone = rec.vorp >= 0 ? 'up' : 'down'
      const signed = `${rec.vorp >= 0 ? '+' : ''}${Number(rec.vorp).toFixed(1)}`
      bits.push(`<span class="${tone}">VORP ${escapeHtml(signed)}</span>`)
    }
    return bits.length ? `<span class="bits">${bits.join('<span class="sep"> · </span>')}</span>` : ''
  }

  function sideHtml(rec) {
    const pos = `<span class="pos ${escapeAttr(rec.position || '')}">${escapeHtml(rec.position || '')}</span>`
    if (rec.marketValue == null) return `<span class="side">${pos}</span>`
    const live = rec.marketSource === 'live ADP'
    const label = live ? 'Live' : 'ADP'
    const title = live ? 'Live ADP' : 'ADP'
    return `<span class="side">${pos}<span class="adp ${live ? 'live' : ''}" title="${escapeAttr(title)}">${escapeHtml(`${label} ${formatAdp(rec.marketValue)}`)}</span></span>`
  }

  function tabLabel(id) {
    if (id === 'roster') return 'Roster'
    if (id === 'board') return 'Board'
    return 'Picks'
  }

  function tabsHtml() {
    return `<div class="tabs">${['picks', 'roster', 'board'].map((id) => (
      `<button type="button" class="tab ${tab === id ? 'on' : ''}" data-tab="${id}">${tabLabel(id)}</button>`
    )).join('')}</div>`
  }

  function needsHtml(state) {
    const needs = state?.needs ?? []
    if (!needs.length) return ''
    return `<div class="needs">${needs.map((need) => (
      `<span class="need ${escapeAttr(need.tone)}" title="${escapeAttr(`${need.filled} of ${need.total} ${need.position} starters`)}">${escapeHtml(need.position)} ${need.filled}/${need.total}</span>`
    )).join('')}</div>`
  }

  function rosterHtml(state) {
    const slots = state?.roster ?? []
    if (!slots.length) return `<div class="empty">Waiting for roster slots…</div>`
    const rows = slots.map((slot) => {
      const filled = Boolean(slot.playerId && slot.name)
      const inner = `<span class="lab">${escapeHtml(slot.label)}</span>${
        filled
          ? `<span class="nm">${escapeHtml(slot.name)}</span><span class="pos ${escapeAttr(slot.position || '')}">${escapeHtml(slot.position || '')}</span>`
          : `<span class="nm">Empty</span>`
      }`
      if (!filled) return `<div class="slot open">${inner}</div>`
      return `<button type="button" class="slot" data-player="${escapeAttr(slot.playerId)}" data-name="${escapeAttr(slot.name)}">${inner}</button>`
    }).join('')
    const count = `${state?.drafted ?? 0}/${slots.length}`
    return `<div class="list"><div class="note" style="padding:0 4px 8px">Your roster · ${escapeHtml(count)}</div>${rows}</div>`
  }

  function boardCellHtml(cell) {
    const cls = [
      'cell',
      cell.position || '',
      cell.yours ? 'yours' : '',
      cell.current ? 'current' : '',
    ].filter(Boolean).join(' ')
    const inner = cell.last
      ? `<b>${escapeHtml(cell.last)}${cell.keeper ? ' · K' : ''}</b><small>${escapeHtml([cell.position, cell.team].filter(Boolean).join(' · ') || `#${cell.pickNo}`)}</small>`
      : cell.current
        ? `<b>${cell.yours ? 'Your pick' : 'On the clock'}</b><small>#${cell.pickNo}</small>`
        : `<small>#${cell.pickNo}</small>`
    if (cell.playerId && cell.name) {
      return `<button type="button" class="${escapeAttr(cls)}" data-player="${escapeAttr(cell.playerId)}" data-name="${escapeAttr(cell.name)}" title="${escapeAttr(cell.name)}">${inner}</button>`
    }
    return `<div class="${escapeAttr(cls)}">${inner}</div>`
  }

  function boardHtml(state) {
    const board = state?.board
    const teams = board?.teams ?? []
    if (!teams.length) return `<div class="empty">Waiting for the draft board…</div>`
    const columns = `22px repeat(${teams.length}, minmax(40px, 1fr))`
    const heads = [`<div class="rd">Rd</div>`, ...teams.map((team) => (
      `<div class="th ${team.you ? 'you' : ''}" title="${escapeAttr(team.name)}">${escapeHtml(team.abbrev)}</div>`
    ))]
    const grid = [...heads]
    const all = board.cells ?? []
    for (let i = 0; i < all.length; i += teams.length) {
      const slice = all.slice(i, i + teams.length)
      grid.push(`<div class="rd">${slice[0]?.round ?? ''}</div>`)
      for (const cell of slice) grid.push(boardCellHtml(cell))
    }
    return `<div class="board" style="grid-template-columns:${columns}">${grid.join('')}</div>`
  }

  function searchOnEspn(name) {
    const nodes = document.querySelectorAll('input, textarea')
    let input = null
    for (const node of nodes) {
      const hint = `${node.placeholder || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('name') || ''}`
      // Not `offsetParent`: it is null for any position:fixed element even when
      // the element is plainly visible, and ESPN keeps the draft-room filter in
      // a fixed toolbar -- so that test rejected the very input we want.
      if (/search|player|filter/i.test(hint) && visible(node)) {
        input = node
        break
      }
    }
    if (!input) return false
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, name)
    input.value = name
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.focus()
    return true
  }

  const CARD_SELECTOR = '.player-card-modal, .lightbox__overlay[role="main"]'
  // Rows carry a Draft/Queue control; opening a card must never hit one.
  const ACTION_TEXT = /\b(draft|queue|add|drop|trade|nominate)\b/i

  function visible(node) {
    const box = node?.getBoundingClientRect?.()
    return Boolean(box && box.width > 0 && box.height > 0)
  }

  function cardOpen() {
    return Boolean(document.querySelector(CARD_SELECTOR))
  }

  function plainName(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[.'’-]/g, '')
      .replace(/\s+(?:jr|sr|ii|iii|iv)$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Elements on the page that refer to one ESPN player.
   *
   * Id first, name only as a last resort: the suggestion already carries the
   * same ESPN id the page uses, so matching on it avoids every duplicate-name
   * and suffix problem. Headshot URLs are the most reliable carrier -- the
   * injected script already reads ids out of them for the activity feed.
   */
  function nodesForPlayer(playerId, name) {
    const found = []
    const id = String(playerId || '')
    if (id) {
      for (const img of document.querySelectorAll('img[src*="/full/"], img[src*="/players/"]')) {
        const src = img.getAttribute('src') || ''
        if (src.match(/(?:full|players)\/(\d+)(?:[._/]|$)/i)?.[1] === id) found.push(img)
      }
      const attrs = `[data-player-id="${id}"], [data-playerid="${id}"], [data-id="${id}"], a[href*="/id/${id}/"], a[href*="/id/${id}?"]`
      for (const el of document.querySelectorAll(attrs)) found.push(el)
    }
    if (name) {
      const wanted = plainName(name)
      for (const el of document.querySelectorAll('.playerinfo__playername, [class*="playername"], [class*="player-name"]')) {
        if (plainName(el.textContent) === wanted) found.push(el)
      }
    }
    return found.filter(visible)
  }

  /** The things worth clicking near a matched node, safest first. */
  function cardTargets(node) {
    const row = node.closest('tr, li, [class*="player-column"], [class*="players-table"], [class*="playerinfo"]')
    const targets = []
    const named = row?.querySelector('.playerinfo__playername, [class*="playername"], [class*="player-name"]')
    if (named) targets.push(named)
    targets.push(node)
    const headshot = row?.querySelector('.player-headshot img, img')
    if (headshot) targets.push(headshot)
    return targets.filter((el) => {
      if (!visible(el)) return false
      // Never a Draft/Queue control, and never something wrapping one.
      if (el.tagName === 'BUTTON' && ACTION_TEXT.test(el.textContent || '')) return false
      return !el.closest('button[class*="draft"], button[class*="queue"]')
    })
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * Open ESPN's own player card for a suggestion.
   *
   * Clicks are tried and then verified rather than trusted: ESPN's markup is
   * generated with per-deploy `jsx-*` class hashes, so the only durable signal
   * that the right thing was hit is the card actually appearing.
   */
  async function openPlayerCard(playerId, name) {
    if (cardOpen()) return true
    for (const node of nodesForPlayer(playerId, name)) {
      for (const target of cardTargets(node)) {
        target.click()
        await wait(120)
        if (cardOpen()) return true
      }
    }
    // Not on screen: the list is filtered or virtualized past it. Filter to the
    // name, let ESPN re-render, then look again.
    if (!searchOnEspn(name)) return false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(150)
      for (const node of nodesForPlayer(playerId, name)) {
        for (const target of cardTargets(node)) {
          target.click()
          await wait(120)
          if (cardOpen()) return true
        }
      }
    }
    return false
  }

  function applyPosition(panel) {
    if (!panel || !pos) return
    panel.style.right = 'auto'
    panel.style.left = pos.left
    panel.style.top = pos.top
  }

  function render() {
    if (!wrap) return
    const state = active()
    if (collapsed) {
      wrap.innerHTML = `<div class="panel mini"><div class="head" data-restore="1"><span class="mark">»</span><span class="title">${escapeHtml(tabLabel(tab))}</span><span class="clock ${state?.youAreOnClock ? 'on' : ''}">${escapeHtml(clockText(state))}</span></div></div>`
      applyPosition(wrap.querySelector('.panel'))
      return
    }
    const recs = state?.recs ?? []
    const rows = recs.map((rec, i) => `
      <button type="button" class="row" data-player="${escapeAttr(rec.id || '')}" data-name="${escapeAttr(rec.name)}">
        <span class="n">${i + 1}</span>
        <span class="who">
          <span class="name">${escapeHtml(rec.name)}</span>
          ${bitsHtml(rec)}
          <span class="why">${escapeHtml(rec.reason || 'Best available')}</span>
        </span>
        ${sideHtml(rec)}
      </button>
    `).join('')
    const picksBody = rows
      ? `<div class="list">${rows}</div>`
      : `<div class="empty">${escapeHtml(state?.error || 'Waiting for the ESPN player pool…')}</div>`
    const body = tab === 'roster' ? rosterHtml(state) : tab === 'board' ? boardHtml(state) : picksBody
    // `valued` says whether the app's numbers reached us; without them the
    // shared scorer still runs, just on ESPN's editorial rank alone.
    const source = state?.valued ? 'App ranks + VORP · live ADP' : 'ESPN draft rank'
    wrap.innerHTML = `
      <div class="panel ${tab === 'board' ? 'wide' : ''}">
        <div class="head" data-drag="1">
          <span class="mark">»</span>
          <span class="title">${escapeHtml(tabLabel(tab))}</span>
          <span class="clock ${state?.youAreOnClock ? 'on' : ''}">${escapeHtml(clockText(state))}</span>
          <button type="button" class="btn" data-collapse="1" aria-label="Minimize">–</button>
        </div>
        ${tabsHtml()}
        ${needsHtml(state)}
        <div class="body">${body}</div>
        ${tab === 'picks' ? `<div class="note">${escapeHtml(source)}. Click a name to search ESPN.</div>` : tab === 'roster' ? `<div class="note">Empty slots are still open. Click a name to search ESPN.</div>` : `<div class="note">Your column is outlined. Click a name to search ESPN.</div>`}
      </div>
    `
    applyPosition(wrap.querySelector('.panel'))
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]))
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '')
  }

  function eventEl(event) {
    const target = event.target
    return target instanceof Element ? target : target?.parentElement ?? null
  }

  function bind() {
    if (!shadow) return
    shadow.addEventListener('click', (event) => {
      const el = eventEl(event)
      if (!el) return
      const restore = el.closest('[data-restore]')
      if (restore) {
        collapsed = false
        render()
        return
      }
      const collapse = el.closest('[data-collapse]')
      if (collapse) {
        event.preventDefault()
        collapsed = true
        render()
        return
      }
      const tabBtn = el.closest('[data-tab]')
      if (tabBtn) {
        event.preventDefault()
        tab = tabBtn.getAttribute('data-tab') || 'picks'
        render()
        return
      }
      const row = el.closest('[data-name]')
      if (row) {
        void openPlayerCard(row.getAttribute('data-player') || '', row.getAttribute('data-name') || '')
      }
    })

    let drag = null
    shadow.addEventListener('mousedown', (event) => {
      const el = eventEl(event)
      if (!el?.closest('[data-drag]')) return
      if (el.closest('button')) return
      const panel = wrap?.querySelector('.panel')
      if (!panel) return
      const box = panel.getBoundingClientRect()
      drag = { x: event.clientX - box.left, y: event.clientY - box.top }
      event.preventDefault()
    })
    window.addEventListener('mousemove', (event) => {
      if (!drag) return
      const panel = wrap?.querySelector('.panel')
      if (!panel) return
      pos = {
        left: `${Math.max(8, event.clientX - drag.x)}px`,
        top: `${Math.max(8, event.clientY - drag.y)}px`,
      }
      applyPosition(panel)
    })
    window.addEventListener('mouseup', () => { drag = null })
  }

  function mount() {
    if (!isDraftPath()) return
    if (host) return
    host = document.createElement('div')
    host.id = HOST_ID
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;width:0;height:0;overflow:visible;pointer-events:none;'
    shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    wrap = document.createElement('div')
    wrap.style.pointerEvents = 'auto'
    shadow.appendChild(style)
    shadow.appendChild(wrap)
    document.documentElement.appendChild(host)
    bind()
    render()
  }

  function unmount() {
    host?.remove()
    host = null
    shadow = null
    wrap = null
  }

  function rescore() {
    const suggest = global.DraftAssistantSuggest
    local = suggest?.fromSnapshot(snapshot, valuations) ?? (snapshot?.error
      ? { leagueId: String(snapshot.leagueId || ''), recs: [], error: snapshot.error }
      : null)
  }

  function updateFromSnapshot(next) {
    snapshot = next
    rescore()
    if (isDraftPath()) {
      mount()
      render()
    } else {
      unmount()
    }
  }

  /** New valuations from the app: rescore the board we already have. */
  function updateValuations(table) {
    valuations = table && table.players ? table : null
    if (!snapshot) return
    rescore()
    if (isDraftPath()) {
      mount()
      render()
    }
  }

  global.DraftAssistantOverlay = { mount, unmount, updateFromSnapshot, updateValuations, isDraftPath, openPlayerCard }
})(typeof globalThis !== 'undefined' ? globalThis : this)
