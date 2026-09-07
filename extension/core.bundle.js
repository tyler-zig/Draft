var DraftAssistantCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/extension/core.ts
  var core_exports = {};
  __export(core_exports, {
    applyValuations: () => applyValuations,
    buildValuations: () => buildValuations,
    draftFrontier: () => draftFrontier,
    espnSnapshotPickStamp: () => espnSnapshotPickStamp,
    livePickNumber: () => livePickNumber,
    mapEspnPicks: () => mapEspnPicks,
    mapEspnPlayers: () => mapEspnPlayers,
    mapEspnSession: () => mapEspnSession,
    nextOpenPickNumber: () => nextOpenPickNumber,
    nextPickNumberForSlot: () => nextPickNumberForSlot,
    occupiedPickNumbers: () => occupiedPickNumbers,
    overlayRoom: () => overlayRoom,
    ownerSlotForPick: () => ownerSlotForPick,
    picksUntilSlot: () => picksUntilSlot,
    recommendPicks: () => recommendPicks,
    suggestionGlance: () => suggestionGlance,
    suggestionSet: () => suggestionSet
  });

  // src/providers/types.ts
  var EMPTY_SLOTS = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    SUPER_FLEX: 0,
    K: 0,
    DEF: 0,
    BN: 0
  };
  function defaultSlotCounts() {
    return {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      SUPER_FLEX: 0,
      K: 1,
      DEF: 1,
      BN: 6
    };
  }

  // src/draft/rosterNeeds.ts
  var FLEX_ELIGIBLE = /* @__PURE__ */ new Set(["RB", "WR", "TE"]);
  var SUPER_FLEX_ELIGIBLE = /* @__PURE__ */ new Set(["QB", "RB", "WR", "TE"]);
  function emptySlotCounts() {
    return { ...EMPTY_SLOTS };
  }
  function slotsFromRosterPositions(positions) {
    const counts = emptySlotCounts();
    for (const raw of positions) {
      const key = normalizeSlot(raw);
      counts[key] += 1;
    }
    return counts;
  }
  function normalizeSlot(raw) {
    const p = raw.toUpperCase();
    if (p === "DST" || p === "D/ST" || p === "DEF") return "DEF";
    if (p === "PK" || p === "K") return "K";
    if (p === "SUPER_FLEX" || p === "SUPERFLEX" || p === "Q/W/R/T") {
      return "SUPER_FLEX";
    }
    if (p === "FLEX" || p === "REC_FLEX" || p === "WRRB_FLEX" || p === "W/R/T" || p === "W/R" || p === "W/T") {
      return "FLEX";
    }
    if (p === "BN" || p === "BENCH" || p === "IR" || p === "TAXI") return "BN";
    if (p === "QB" || p === "RB" || p === "WR" || p === "TE") return p;
    return "BN";
  }
  function takeFirst(remaining, pred) {
    const index = remaining.findIndex(pred);
    if (index < 0) return null;
    const [player] = remaining.splice(index, 1);
    return player ?? null;
  }
  var FILL_ORDER = [
    { key: "QB", pred: (p) => p.position === "QB" },
    { key: "RB", pred: (p) => p.position === "RB" },
    { key: "WR", pred: (p) => p.position === "WR" },
    { key: "TE", pred: (p) => p.position === "TE" },
    { key: "K", pred: (p) => p.position === "K" },
    { key: "DEF", pred: (p) => p.position === "DEF" },
    { key: "FLEX", pred: (p) => FLEX_ELIGIBLE.has(p.position) },
    { key: "SUPER_FLEX", pred: (p) => SUPER_FLEX_ELIGIBLE.has(p.position) },
    { key: "BN", pred: () => true }
  ];
  function fillRoster(slots, players) {
    const remaining = [...players];
    const filled = [];
    for (const { key, pred } of FILL_ORDER) {
      const count = slots[key];
      for (let i = 0; i < count; i += 1) {
        const ordinal = count > 1 ? `${key}${i + 1}` : key;
        filled.push({
          key,
          label: key === "SUPER_FLEX" ? count > 1 ? `SF ${i + 1}` : "SF" : ordinal,
          player: takeFirst(remaining, pred)
        });
      }
    }
    return filled;
  }
  function needForPosition(slots, filled, position) {
    if (position in slots && position !== "FLEX" && position !== "SUPER_FLEX" && position !== "BN") {
      const key = position;
      const total = slots[key];
      const taken = filled.filter((s) => s.key === key && s.player).length;
      if (taken < total) {
        const label = total > 1 ? `Fill ${key}${taken + 1}` : `Fill ${key}`;
        return { kind: "starter", label };
      }
    }
    if (FLEX_ELIGIBLE.has(position) && filled.some((s) => s.key === "FLEX" && !s.player)) {
      return { kind: "flex", label: "Fill FLEX" };
    }
    if (SUPER_FLEX_ELIGIBLE.has(position) && filled.some((s) => s.key === "SUPER_FLEX" && !s.player)) {
      return { kind: "superflex", label: "Fill Superflex" };
    }
    return { kind: "bench", label: "Best available" };
  }

  // src/draft/snake.ts
  function publishedSlot(owners, pickNo) {
    const slot = owners?.[pickNo - 1];
    return slot != null && slot > 0 ? slot : null;
  }
  function ownerSlotForPick(pickNo, teams, type, owners) {
    if (pickNo < 1 || teams < 1) {
      return { round: 1, slot: 1 };
    }
    const round = Math.ceil(pickNo / teams);
    const published = publishedSlot(owners, pickNo);
    if (published != null) return { round, slot: published };
    const indexInRound = (pickNo - 1) % teams;
    if (type === "snake" && round % 2 === 0) {
      return { round, slot: teams - indexInRound };
    }
    return { round, slot: indexInRound + 1 };
  }
  function nextOpenPickNumber(takenPickNos, total) {
    const taken = takenPickNos instanceof Set ? takenPickNos : new Set(takenPickNos);
    for (let pick = 1; pick <= total; pick += 1) {
      if (!taken.has(pick)) return pick;
    }
    return Math.max(total, 1);
  }
  function livePickNumber(takenPickNos, total, frontier = 0) {
    const taken = takenPickNos instanceof Set ? takenPickNos : new Set(takenPickNos);
    const start = frontier > 0 ? Math.min(frontier, Math.max(total, 1)) : 1;
    for (let pick = start; pick <= total; pick += 1) {
      if (!taken.has(pick)) return pick;
    }
    return Math.max(total, 1);
  }
  function picksUntilSlot(currentPickNo, yourSlot, teams, rounds, type, takenPickNos, owners) {
    if (type === "auction") return null;
    const total = teams * rounds;
    const taken = takenPickNos === void 0 ? null : takenPickNos instanceof Set ? takenPickNos : new Set(takenPickNos);
    let waiting = 0;
    for (let pick = currentPickNo; pick <= total; pick += 1) {
      if (taken?.has(pick)) continue;
      const { slot } = ownerSlotForPick(pick, teams, type, owners);
      if (slot === yourSlot) return waiting;
      waiting += 1;
    }
    return null;
  }
  function nextPickNumberForSlot(currentPickNo, yourSlot, teams, rounds, type, takenPickNos, owners) {
    if (type === "auction") return null;
    const total = teams * rounds;
    const taken = takenPickNos === void 0 ? null : takenPickNos instanceof Set ? takenPickNos : new Set(takenPickNos);
    for (let pick = currentPickNo; pick <= total; pick += 1) {
      if (taken?.has(pick)) continue;
      if (ownerSlotForPick(pick, teams, type, owners).slot === yourSlot) return pick;
    }
    return null;
  }
  function pickNumberFor(round, slot, teams, type, owners) {
    const start = (round - 1) * teams;
    if (owners) {
      for (let offset = 0; offset < teams; offset += 1) {
        if (publishedSlot(owners, start + offset + 1) === slot) return start + offset + 1;
      }
    }
    if (type === "snake" && round % 2 === 0) {
      return start + (teams - slot + 1);
    }
    return start + slot;
  }

  // src/espn/mapEspn.ts
  var PRO_TEAMS = {
    0: "FA",
    1: "ATL",
    2: "BUF",
    3: "CHI",
    4: "CIN",
    5: "CLE",
    6: "DAL",
    7: "DEN",
    8: "DET",
    9: "GB",
    10: "TEN",
    11: "IND",
    12: "KC",
    13: "LV",
    14: "LAR",
    15: "MIA",
    16: "MIN",
    17: "NE",
    18: "NO",
    19: "NYG",
    20: "NYJ",
    21: "PHI",
    22: "ARI",
    23: "PIT",
    24: "LAC",
    25: "SF",
    26: "SEA",
    27: "TB",
    28: "WSH",
    29: "CAR",
    30: "JAX",
    33: "BAL",
    34: "HOU"
  };
  var POSITION_BY_ID = {
    1: "QB",
    2: "RB",
    3: "WR",
    4: "TE",
    5: "K",
    16: "DEF"
  };
  var SLOT_ID_TO_POS = {
    "0": "QB",
    "2": "RB",
    "4": "WR",
    "6": "TE",
    "7": "SUPER_FLEX",
    "16": "DEF",
    "17": "K",
    "20": "BN",
    "23": "FLEX"
  };
  function espnDraftId(season, leagueId) {
    return `${season}:${leagueId}`;
  }
  function espnSnapshotPickStamp(snapshot) {
    const picks = snapshot?.league?.draftDetail?.picks ?? [];
    const last = picks[picks.length - 1];
    return `${picks.length}:${last?.playerId ?? ""}:${last?.overallPickNumber ?? ""}:${last?.roundId ?? ""}:${last?.roundPickNumber ?? ""}`;
  }
  var PRACTICE_SUBTYPES = /* @__PURE__ */ new Set(["CUSTOM_MOCK", "MOCKDRAFT_LOBBY", "PRACTICE", "MOCK"]);
  var PRACTICE_SUBTYPE_IDS = /* @__PURE__ */ new Set([4, 5]);
  function isEspnPracticeLeague(league) {
    if (!league) return false;
    const name = String(league.settings?.name ?? "");
    if (/\b(?:practice|mock)\s+draft\b/i.test(name)) return true;
    const subtype = league.settings?.leagueSubType ?? league.leagueSubType;
    const normalized = typeof subtype === "string" ? subtype.trim().toUpperCase().replace(/[ -]+/g, "_") : subtype;
    if (typeof normalized === "string" && (PRACTICE_SUBTYPES.has(normalized) || normalized.includes("MOCK") || normalized.includes("PRACTICE"))) return true;
    if (Number(normalized) === 4 || Number(normalized) === 5) return true;
    const subtypeId = league.settings?.leagueSubTypeId ?? league.leagueSubTypeId;
    return PRACTICE_SUBTYPE_IDS.has(Number(subtypeId));
  }
  function isEspnPracticeSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.isPractice) return true;
    if (isEspnPracticeLeague(snapshot.league)) return true;
    const page = snapshot.pageUrl ?? "";
    return /\/(?:mockdraftlobby|waitingroom)\b/i.test(page);
  }
  function leagueDisplayName(league, leagueId, practice) {
    const name = league.settings?.name || `ESPN ${leagueId}`;
    if (!practice || /practice|mock/i.test(name)) return name;
    return `${name} (Practice)`;
  }
  var TE_SLOT_ID = "6";
  function receptionItem(league) {
    return league.settings?.scoringSettings?.scoringItems?.find(
      (item) => item.statId === 53
    );
  }
  function classifyReceptionPoints(points) {
    if (points >= 0.9) return "ppr";
    if (points >= 0.4) return "half_ppr";
    return "std";
  }
  function mapScoring(league) {
    const items = league.settings?.scoringSettings?.scoringItems;
    if (!items?.length) return "unknown";
    const rec = items.find((item) => item.statId === 53);
    if (!rec) return "std";
    return classifyReceptionPoints(rec.points);
  }
  function mapReceptionPremium(league) {
    const rec = receptionItem(league);
    const overrides = rec?.pointsOverrides;
    if (!rec || !overrides) return null;
    const premium = [];
    for (const [slotId, points] of Object.entries(overrides)) {
      if (typeof points !== "number" || points === rec.points) continue;
      const position = slotId === TE_SLOT_ID ? "TE" : SLOT_ID_TO_POS[slotId] ?? `Slot ${slotId}`;
      premium.push({ position, points });
    }
    return premium.length ? premium : null;
  }
  var ESPN_STAT_ID_TO_KEY = {
    3: "pass_yd",
    22: "pass_yd",
    4: "pass_td",
    20: "pass_int",
    24: "rush_yd",
    40: "rush_yd",
    25: "rush_td",
    41: "rec",
    53: "rec",
    42: "rec_yd",
    61: "rec_yd",
    43: "rec_td"
  };
  function mapScoringSettings(league) {
    const items = league.settings?.scoringSettings?.scoringItems;
    if (!items?.length) return null;
    const settings = {};
    for (const item of items) {
      const key = ESPN_STAT_ID_TO_KEY[item.statId];
      if (key) settings[key] = item.points;
    }
    return Object.keys(settings).length ? settings : null;
  }
  function mapDraftType(raw) {
    if (raw === "AUCTION" || raw === "SALARY_CAP") return "auction";
    if (raw === "SNAKE") return "snake";
    return "linear";
  }
  function mapStatus(league) {
    if (league.draftDetail?.inProgress) return "drafting";
    if (league.draftDetail?.drafted) return "complete";
    return "pre_draft";
  }
  function teamName(team) {
    const combined = `${team.location ?? ""} ${team.nickname ?? ""}`.trim();
    return combined || team.name || team.abbrev || `Team ${team.id}`;
  }
  function espnTeamLogo(team) {
    const logo = team?.logo?.trim();
    return logo && /^https?:\/\//i.test(logo) ? logo : null;
  }
  function slotCounts(league) {
    const counts = league.settings?.rosterSettings?.lineupSlotCounts;
    if (!counts) {
      const fallback = defaultSlotCounts();
      return {
        slots: fallback,
        rosterPositions: Object.entries(fallback).flatMap(
          ([pos, n]) => Array.from({ length: n }, () => pos)
        )
      };
    }
    const rosterPositions = [];
    for (const [id, n] of Object.entries(counts)) {
      const pos = SLOT_ID_TO_POS[id];
      if (!pos || n <= 0) continue;
      for (let i = 0; i < n; i += 1) rosterPositions.push(pos);
    }
    return {
      slots: slotsFromRosterPositions(rosterPositions),
      rosterPositions
    };
  }
  function buildTeamSlots(league) {
    const map = /* @__PURE__ */ new Map();
    const teams = [...league.teams ?? []];
    const teamCount = league.settings?.size ?? teams.length;
    const draftType = mapDraftType(league.settings?.draftSettings?.type);
    const pickOrder = league.settings?.draftSettings?.pickOrder ?? [];
    if (pickOrder.length === teamCount && new Set(pickOrder).size === teamCount) {
      pickOrder.forEach((teamId, index) => map.set(Number(teamId), index + 1));
      return map;
    }
    const usedSlots = /* @__PURE__ */ new Set();
    for (const pick of league.draftDetail?.picks ?? []) {
      if (!pick.teamId || !pick.roundId || !pick.roundPickNumber) continue;
      const slot = draftType === "snake" && pick.roundId % 2 === 0 ? teamCount - pick.roundPickNumber + 1 : pick.roundPickNumber;
      if (slot < 1 || slot > teamCount) continue;
      const existing = map.get(pick.teamId);
      if (existing === slot) continue;
      if (existing != null || usedSlots.has(slot)) continue;
      map.set(pick.teamId, slot);
      usedSlots.add(slot);
    }
    if (map.size === teamCount) return map;
    teams.sort(
      (a, b) => (a.draftPosition ?? a.id) - (b.draftPosition ?? b.id)
    );
    const openSlots = Array.from({ length: teamCount }, (_, index) => index + 1).filter((slot) => !usedSlots.has(slot));
    for (const team of teams) {
      if (map.has(team.id)) continue;
      const preferred = team.draftPosition;
      const preferredIndex = preferred == null ? -1 : openSlots.indexOf(preferred);
      const slot = preferredIndex >= 0 ? openSlots.splice(preferredIndex, 1)[0] : openSlots.shift();
      if (slot != null) map.set(team.id, slot);
    }
    return map;
  }
  function buildPickOwners(league, teamSlots) {
    const picks = league.draftDetail?.picks ?? [];
    if (!picks.length) return null;
    const owners = [];
    let known = 0;
    for (const pick of picks) {
      const overall = Number(pick.overallPickNumber);
      if (!(overall > 0) || pick.teamId == null) continue;
      const slot = teamSlots.get(pick.teamId);
      if (slot == null) continue;
      while (owners.length < overall) owners.push(null);
      if (owners[overall - 1] == null) known += 1;
      owners[overall - 1] = slot;
    }
    return known > 0 ? owners : null;
  }
  function snapshotIds(snapshot) {
    const leagueId = snapshot.leagueId;
    const season = snapshot.season || "2026";
    if (!leagueId) {
      throw new Error("ESPN snapshot has no league id");
    }
    return { leagueId, season };
  }
  function mapEspnSession(snapshot, yourUserId) {
    const league = snapshot.league;
    const { leagueId, season } = snapshotIds(snapshot);
    if (!league) {
      throw new Error("ESPN snapshot has no league payload");
    }
    const { slots, rosterPositions } = slotCounts(league);
    const teamSlots = buildTeamSlots(league);
    const members = new Map(
      (league.members ?? []).map((m) => [m.id, m.displayName ?? m.id])
    );
    const teams = league.teams ?? [];
    const teamCount = league.settings?.size ?? teams.length;
    const order = Array.from({ length: teamCount }, (_, i) => {
      const slot = i + 1;
      const team = teams.find((t) => teamSlots.get(t.id) === slot) ?? teams[i];
      const userId = team ? String(team.id) : String(slot);
      const ownerName = team?.primaryOwner ? members.get(team.primaryOwner) : void 0;
      return {
        slot,
        rosterId: userId,
        userId,
        displayName: ownerName || (team ? teamName(team) : `Slot ${slot}`),
        teamName: team ? teamName(team) : `Slot ${slot}`,
        avatar: espnTeamLogo(team),
        isYou: userId === yourUserId
      };
    });
    const practice = isEspnPracticeSnapshot(snapshot);
    return {
      provider: "espn",
      draftId: espnDraftId(season, leagueId),
      leagueId,
      name: leagueDisplayName(league, leagueId, practice),
      type: mapDraftType(league.settings?.draftSettings?.type),
      status: mapStatus(league),
      season,
      scoringType: mapScoring(league),
      teams: teamCount,
      rounds: Math.max(rosterPositions.length, 1),
      pickTimer: league.settings?.draftSettings?.pickTimeout ?? null,
      clockEndsAt: snapshot.clock?.paused ? null : snapshot.clock?.endsAt ?? null,
      clockPaused: Boolean(snapshot.clock?.paused),
      slots,
      rosterPositions,
      order,
      yourUserId,
      yourSlot: order.find((s) => s.isYou)?.slot ?? null,
      startTime: league.settings?.draftSettings?.availableDate ?? null,
      keeperCount: practice ? null : league.settings?.draftSettings?.keeperCount ?? null,
      receptionPremium: mapReceptionPremium(league),
      scoringSettings: mapScoringSettings(league),
      // The ESPN settings payload does not publish a playoff week window;
      // callers fall back to the standard weeks 15-17 default.
      playoffWeeks: null,
      pickOwners: buildPickOwners(league, teamSlots),
      isPractice: practice
    };
  }
  var EMPTY_PICK_PLAYER_ID = -1;
  function pickHasPlayer(pick) {
    return pick.playerId != null && pick.playerId !== EMPTY_PICK_PLAYER_ID && pick.playerId !== 0;
  }
  function mapEspnPicks(snapshot) {
    const league = snapshot.league;
    if (!league) return [];
    const teamSlots = buildTeamSlots(league);
    const teamCount = league.settings?.size ?? league.teams?.length ?? teamSlots.size;
    const draftType = mapDraftType(league.settings?.draftSettings?.type);
    const owners = buildPickOwners(league, teamSlots);
    const players = new Map(
      mapEspnPlayers(snapshot).map((p) => [p.id, p])
    );
    return (league.draftDetail?.picks ?? []).filter((pick) => pickHasPlayer(pick) && Boolean(pick.overallPickNumber || pick.roundId && pick.roundPickNumber || pick.keeper || pick.reservedForKeeper)).map((pick) => {
      const playerId = String(pick.playerId);
      const player = players.get(playerId);
      const slot = pick.teamId ? teamSlots.get(pick.teamId) : void 0;
      const round = pick.roundId ?? 1;
      const draftSlot = slot ?? pick.roundPickNumber ?? 1;
      const pickNo = pick.overallPickNumber || (teamCount > 0 ? pickNumberFor(round, draftSlot, teamCount, draftType, owners) : 0);
      return {
        playerId,
        pickedByUserId: pick.teamId != null ? String(pick.teamId) : null,
        rosterId: pick.teamId != null ? String(pick.teamId) : null,
        round,
        draftSlot,
        pickNo,
        isKeeper: Boolean(pick.keeper || pick.reservedForKeeper),
        meta: player ? {
          firstName: player.firstName,
          lastName: player.lastName,
          position: player.position,
          team: player.team,
          injuryStatus: player.injuryStatus
        } : null
      };
    }).sort((a, b) => a.pickNo - b.pickNo);
  }
  function mapEspnPlayers(snapshot) {
    const scoring = snapshot.league ? mapScoring(snapshot.league) : "unknown";
    const rankKey = scoring === "ppr" || scoring === "half_ppr" ? "PPR" : "STANDARD";
    const players = [];
    for (const entry of snapshot.players ?? []) {
      const nested = entry.player;
      const id = String(nested?.id ?? entry.id ?? "");
      if (!id) continue;
      const positionId = nested?.defaultPositionId ?? entry.defaultPositionId;
      const position = POSITION_BY_ID[positionId ?? -1];
      if (!position) continue;
      const firstName = nested?.firstName ?? entry.firstName ?? "";
      const lastName2 = nested?.lastName ?? entry.lastName ?? "";
      const fullName = nested?.fullName || entry.fullName || `${firstName} ${lastName2}`.trim() || id;
      const ranks = nested?.draftRanksByRankType;
      const rank = ranks?.[rankKey]?.rank ?? ranks?.STANDARD?.rank ?? ranks?.PPR?.rank ?? 9999;
      const injuryStatus = nested?.injuryStatus;
      const injury = injuryStatus && injuryStatus !== "ACTIVE" ? injuryStatus : null;
      const proTeamId = nested?.proTeamId ?? entry.proTeamId ?? 0;
      const espnAdp = nested?.ownership?.averageDraftPosition;
      players.push({
        id,
        firstName,
        lastName: lastName2,
        fullName,
        position,
        team: PRO_TEAMS[proTeamId] ?? null,
        searchRank: rank > 0 ? rank : 9999,
        injuryStatus: injury,
        number: nested?.jersey ?? null,
        yearsExp: null,
        bye: null,
        espnId: id,
        adp: typeof espnAdp === "number" && espnAdp > 0 ? espnAdp : null
      });
    }
    players.sort((a, b) => a.searchRank - b.searchRank);
    return players;
  }

  // src/draft/pickSlots.ts
  function occupiesDraftSlot(pick) {
    return pick.pickNo > 0;
  }
  function occupiedPickNumbers(picks) {
    return new Set(picks.filter(occupiesDraftSlot).map((pick) => pick.pickNo));
  }
  function draftFrontier(picks) {
    let frontier = 0;
    for (const pick of picks) {
      if (pick.isKeeper || !occupiesDraftSlot(pick)) continue;
      if (pick.pickNo > frontier) frontier = pick.pickNo;
    }
    return frontier;
  }

  // src/rankings/aliases.ts
  var NAME_ALIASES = {
    // Marquise "Hollywood" Brown, WR. Sleeper and ESPN agree on id 4241372.
    "hollywood brown": "marquise brown",
    // Zonovan "Bam" Knight, RB.
    "bam knight": "zonovan knight",
    // Antwane "Juice" Wells Jr., WR. FantasyPros also carries the suffix.
    "juice wells": "antwane wells",
    // DeaMonte "Chip" Trayanum, RB.
    "chip trayanum": "deamonte trayanum"
  };
  function resolveNameAlias(normalized) {
    return NAME_ALIASES[normalized] ?? normalized;
  }

  // src/rankings/normalize.ts
  var SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
  var PUNCT = /[.'’`-]/g;
  function normalizeName(value) {
    const base = value.toLowerCase().replace(PUNCT, "").replace(SUFFIX, "").replace(/\s+/g, " ").trim();
    return resolveNameAlias(base);
  }
  function normalizeTeam(value) {
    if (!value) return null;
    const t = value.toUpperCase().trim();
    const aliases = {
      JAC: "JAX",
      WAS: "WSH",
      WSH: "WSH",
      WASHINGTON: "WSH",
      LAR: "LAR",
      LA: "LAR",
      STL: "LAR",
      SD: "LAC",
      LAC: "LAC",
      OAK: "LV",
      LV: "LV",
      DST: "",
      DEF: ""
    };
    return aliases[t] ?? t;
  }
  function normalizePos(value) {
    if (!value) return null;
    const p = value.toUpperCase().trim();
    if (p === "DST" || p === "D/ST" || p === "DEF") return "DEF";
    if (p === "PK") return "K";
    return p;
  }

  // src/draft/byeWeeks.ts
  function scoreByeFit(options) {
    const { bye, position, addingStarter, roster } = options;
    if (bye == null) return { delta: 0, reason: null };
    let startersOut = 0;
    let samePosStarters = 0;
    let totalOut = 0;
    for (const player of roster) {
      if (player?.bye !== bye) continue;
      totalOut += 1;
      if (!player.starter) continue;
      startersOut += 1;
      if (player.position === position) samePosStarters += 1;
    }
    if (!addingStarter) {
      if (totalOut >= 4) return { delta: -10, reason: `${totalOut + 1} on bye ${bye}` };
      return { delta: 0, reason: null };
    }
    if (samePosStarters >= 2) {
      return { delta: -25, reason: `${samePosStarters + 1} ${position}s on bye ${bye}` };
    }
    if (startersOut >= 3) {
      return { delta: -28, reason: `${startersOut + 1} starters on bye ${bye}` };
    }
    if (startersOut >= 2) {
      return { delta: -16, reason: `${startersOut + 1} starters on bye ${bye}` };
    }
    if (samePosStarters >= 1) {
      return { delta: -12, reason: `2 ${position}s on bye ${bye}` };
    }
    if (startersOut === 0 && totalOut === 0) {
      return { delta: 10, reason: `Open bye ${bye}` };
    }
    return { delta: 0, reason: null };
  }

  // src/draft/injuryStatus.ts
  var SEVERE = /^(out|ir|pup|nfi|dnr|sus|susp|suspended|suspension|injury reserve|injured reserve)$/i;
  function normalizeInjury(status) {
    return status.trim().replace(/[_\s-]+/g, " ");
  }
  function injuryTone(status) {
    if (!status) return null;
    const key = normalizeInjury(status);
    if (!key || /^active$/i.test(key)) return null;
    return SEVERE.test(key) ? "out" : "warn";
  }
  function isSevereInjury(status) {
    return injuryTone(status) === "out";
  }

  // src/draft/survival.ts
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * ax);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
  }
  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }
  function spreadFor(player) {
    if (player.rankStdDev != null && player.rankStdDev > 0) return player.rankStdDev;
    if (player.rankLow != null && player.rankHigh != null && player.rankHigh > player.rankLow) {
      return (player.rankHigh - player.rankLow) / 4;
    }
    return null;
  }
  function survivalProbability(mean, stdDev, nextPickNo) {
    if (stdDev <= 0) return nextPickNo <= mean ? 1 : 0;
    const z = (nextPickNo - mean) / stdDev;
    return Math.min(1, Math.max(0, 1 - normalCdf(z)));
  }
  function survivalAdjustment(survival) {
    const urgency = 1 - survival;
    let delta = urgency * 40;
    if (survival >= 0.65) delta -= (survival - 0.5) * 30;
    return {
      delta,
      reason: urgency > 0.5 ? `${Math.round(urgency * 100)}% gone by next pick` : null
    };
  }

  // src/draft/playerContext.ts
  function usableAdp(value) {
    return value != null && value > 0 && value < 9e3;
  }
  function marketBaseline(player) {
    if (usableAdp(player.liveAdp)) {
      return { value: player.liveAdp, source: "live ADP" };
    }
    if (usableAdp(player.adp)) {
      return { value: player.adp, source: "ADP" };
    }
    return null;
  }
  function suggestionGlance(player, currentPickNo) {
    const baseline = marketBaseline(player);
    return {
      team: player.team,
      liveAdp: usableAdp(player.liveAdp) ? player.liveAdp : null,
      adp: usableAdp(player.adp) ? player.adp : null,
      vorp: player.vorp ?? null,
      marketSource: baseline?.source ?? null,
      marketValue: baseline?.value ?? null,
      vsPick: baseline ? Math.round(currentPickNo - baseline.value) : null
    };
  }

  // src/draft/recommend.ts
  var UNRANKED = 9999;
  var FORCED_STARTER = 1e3;
  function availablePlayers(players, picks) {
    const taken = new Set(picks.map((p) => p.playerId));
    return players.filter((p) => !taken.has(p.id));
  }
  function rankOf(player) {
    return player.searchRank > 0 ? player.searchRank : UNRANKED;
  }
  function buildScoreCurve(players) {
    const anchors = players.filter((p) => p.vorp != null && p.searchRank > 0 && p.searchRank < UNRANKED).map((p) => ({ rank: p.searchRank, score: p.vorp * 3 })).sort((a, b) => a.rank - b.rank);
    if (anchors.length === 0) return null;
    const WINDOW = 5;
    const ranks = [];
    const scores = [];
    for (let index = 0; index < anchors.length; index += 1) {
      const from = Math.max(0, index - Math.floor(WINDOW / 2));
      const window = anchors.slice(from, from + WINDOW).map((a) => a.score).sort((a, b) => a - b);
      ranks.push(anchors[index].rank);
      scores.push(window[Math.floor(window.length / 2)]);
    }
    return { ranks, scores };
  }
  function scoreAtRank(rank, curve) {
    const { ranks, scores } = curve;
    if (rank <= ranks[0]) return scores[0];
    if (rank >= ranks[ranks.length - 1]) return scores[scores.length - 1];
    let low = 0;
    let high = ranks.length - 1;
    while (high - low > 1) {
      const mid = low + high >> 1;
      if (ranks[mid] <= rank) low = mid;
      else high = mid;
    }
    const span = ranks[high] - ranks[low];
    if (span <= 0) return scores[low];
    const t = (rank - ranks[low]) / span;
    return scores[low] + t * (scores[high] - scores[low]);
  }
  function liveAdpTrendAdjustment(player) {
    const oneDay = player.liveAdpVsLastOne;
    const sevenDay = player.liveAdpVsLastSeven;
    const vs = oneDay != null && Number.isFinite(oneDay) ? oneDay : sevenDay;
    if (vs == null || !Number.isFinite(vs) || Math.abs(vs) < 2) return null;
    const delta = Math.max(-18, Math.min(18, vs * 1.2));
    const window = oneDay != null && Number.isFinite(oneDay) ? "1 day" : "7 days";
    return {
      delta,
      reason: delta > 0 ? `Rising ADP vs last ${window}` : `Falling ADP vs last ${window}`
    };
  }
  function baseScore(player, curve) {
    if (!curve) return Math.max(0, 450 - rankOf(player));
    if (player.vorp != null) return player.vorp * 3;
    return scoreAtRank(rankOf(player), curve);
  }
  function recommendPicks(options) {
    const {
      players,
      picks,
      yourSlot,
      slots,
      currentPickNo,
      limit = 5,
      queuedIds = [],
      yourNextPickNo = null
    } = options;
    const queued = new Set(queuedIds);
    const pool = availablePlayers(players, picks);
    const scoreCurve = buildScoreCurve(players);
    const playerById = new Map(players.map((p) => [p.id, p]));
    const yourPicks = picks.filter((p) => p.draftSlot === yourSlot);
    const yourPlayers = yourPicks.map((p) => playerById.get(p.playerId)).filter((p) => Boolean(p));
    const filled = fillRoster(slots, yourPlayers);
    const remainingByPos = /* @__PURE__ */ new Map();
    const eliteCutoff = currentPickNo + 24;
    for (const player of pool) {
      if (rankOf(player) <= eliteCutoff) {
        remainingByPos.set(
          player.position,
          (remainingByPos.get(player.position) ?? 0) + 1
        );
      }
    }
    const tierGroupSize = /* @__PURE__ */ new Map();
    for (const player of pool) {
      if (player.tier == null) continue;
      const key = `${player.position}:${player.tier}`;
      tierGroupSize.set(key, (tierGroupSize.get(key) ?? 0) + 1);
    }
    const RUN_WINDOW = 8;
    const recentPicks = [...picks].sort((a, b) => b.pickNo - a.pickNo).slice(0, RUN_WINDOW);
    const runningPositions = /* @__PURE__ */ new Set();
    if (recentPicks.length >= 4) {
      const byPos = /* @__PURE__ */ new Map();
      for (const pick of recentPicks) {
        const position = playerById.get(pick.playerId)?.position ?? pick.meta?.position;
        if (!position) continue;
        byPos.set(position, (byPos.get(position) ?? 0) + 1);
      }
      for (const [position, count] of byPos) {
        if (count / recentPicks.length >= 0.5) runningPositions.add(position);
      }
    }
    const rosterSpots = Object.values(slots).reduce((sum, count) => sum + count, 0);
    const picksLeft = Math.max(1, rosterSpots - yourPlayers.length);
    const openStarters = filled.filter((slot) => slot.key !== "BN" && !slot.player).length;
    const needScale = Math.min(1, openStarters / picksLeft);
    const mustFillStarters = openStarters >= picksLeft;
    const byeRoster = filled.map((slot) => slot.player ? { bye: slot.player.bye, position: slot.player.position, starter: slot.key !== "BN" } : null);
    const rosteredStarters = yourPlayers.filter((p) => p.depthChartOrder != null && p.depthChartOrder > 0 && p.team);
    const yourQb = yourPlayers.find((p) => p.position === "QB") ?? null;
    const yourPassCatchers = yourPlayers.filter((p) => p.position === "WR" || p.position === "TE");
    const rosteredNamesake = /* @__PURE__ */ new Set();
    for (const player of pool) {
      if (!player.team || player.position === "DEF") continue;
      const key = `${normalizeName(player.fullName)}|${normalizePos(player.position) ?? ""}`;
      if (key !== "|") rosteredNamesake.add(key);
    }
    const draftedStarters = picks.map((p) => playerById.get(p.playerId)).filter((p) => Boolean(p)).filter((p) => p.depthChartOrder != null && p.depthChartOrder > 0 && p.team && !yourPlayers.some((y) => y.id === p.id));
    const scored = pool.map((player) => {
      const rank = rankOf(player);
      const baseline = marketBaseline(player);
      const need = needForPosition(slots, filled, player.position);
      const reasons = [];
      const breakdown = [];
      let score = baseScore(player, scoreCurve);
      breakdown.push({ label: player.vorp != null ? "Projected value (VORP)" : "Value estimated from rank", delta: score });
      const add = (label, delta) => {
        if (!delta) return;
        score += delta;
        breakdown.push({ label, delta });
      };
      let survival = null;
      if (yourNextPickNo != null && yourNextPickNo > currentPickNo) {
        const spread = baseline ? spreadFor(player) : null;
        if (baseline && spread != null) {
          survival = survivalProbability(baseline.value, spread, yourNextPickNo);
          const wait = survivalAdjustment(survival);
          add(wait.reason ?? "Unlikely to last", wait.delta);
          if (wait.reason) reasons.push(wait.reason);
        }
      }
      if (need.kind === "starter") {
        add(need.label, 55 * needScale);
        reasons.push(need.label);
      } else if (need.kind === "flex") {
        add(need.label, 28 * needScale);
        reasons.push(need.label);
      } else if (need.kind === "superflex") {
        add(need.label, 34 * needScale);
        reasons.push(need.label);
      }
      if (mustFillStarters && need.kind !== "bench") {
        add("Last chance to fill a starter", FORCED_STARTER);
        reasons.unshift("Last chance to fill a starter");
      }
      if (baseline) {
        const valueGap = currentPickNo - baseline.value;
        if (valueGap >= 8) {
          add(`Value vs ${baseline.source}`, 22);
          reasons.push(`Value vs ${baseline.source}`);
        }
        const reachGap = baseline.value - currentPickNo;
        if (reachGap > 18) {
          add(`Reach vs ${baseline.source} ${baseline.value.toFixed(1)}`, -(reachGap - 18) * 1.4);
        }
        const trend = liveAdpTrendAdjustment(player);
        if (trend) {
          add(trend.reason, trend.delta);
          reasons.push(trend.reason);
        }
      } else if (rank < UNRANKED) {
        reasons.push("No ADP data");
      }
      const remainingElite = remainingByPos.get(player.position) ?? 0;
      if (need.kind !== "bench" && remainingElite > 0 && remainingElite <= 3) {
        add(`${player.position} running thin`, 22 * needScale);
        reasons.push(`${player.position} running thin`);
      }
      if (player.tier != null && (tierGroupSize.get(`${player.position}:${player.tier}`) ?? 0) === 1) {
        add(`Last Tier ${player.tier} ${player.position}`, 32);
        reasons.push(`Last Tier ${player.tier} ${player.position}`);
      }
      if (need.kind !== "bench" && runningPositions.has(player.position)) {
        add(`${player.position} run`, 12 * needScale);
        reasons.push(`${player.position} run`);
      }
      const byeFit = scoreByeFit({
        bye: player.bye,
        position: player.position,
        addingStarter: need.kind !== "bench",
        roster: byeRoster
      });
      add(byeFit.reason ?? "Bye week fit", byeFit.delta);
      if (byeFit.reason) reasons.push(byeFit.reason);
      const handcuffFor = rosteredStarters.find(
        (starter) => starter.team === player.team && starter.position === player.position && player.depthChartOrder != null && player.depthChartOrder > 0 && starter.depthChartOrder != null && player.depthChartOrder > starter.depthChartOrder
      );
      if (handcuffFor) {
        add(`Handcuff for ${handcuffFor.fullName}`, 15);
        reasons.push(`Handcuff for ${handcuffFor.fullName}`);
      }
      if (player.team && player.depthChartOrder != null && player.depthChartOrder > 0) {
        const starterGone = draftedStarters.find(
          (starter) => starter.position === player.position && normalizeTeam(starter.team) === normalizeTeam(player.team) && starter.depthChartOrder != null && starter.depthChartOrder < player.depthChartOrder
        );
        if (starterGone) {
          add(`Starter ${starterGone.fullName} already drafted`, 10);
          reasons.push(`Starter ${starterGone.fullName} already drafted`);
        }
      }
      if (player.position === "QB" && player.team) {
        const stackMate = yourPassCatchers.find(
          (p) => p.team && normalizeTeam(p.team) === normalizeTeam(player.team)
        );
        if (stackMate) {
          add(`Stack with ${stackMate.fullName}`, 12);
          reasons.push(`Stack with ${stackMate.fullName}`);
        }
      }
      if ((player.position === "WR" || player.position === "TE") && yourQb?.team && player.team && normalizeTeam(yourQb.team) === normalizeTeam(player.team)) {
        add(`QB stack with ${yourQb.fullName}`, 12);
        reasons.push(`QB stack with ${yourQb.fullName}`);
      }
      if (player.depthChartOrder != null && player.depthChartOrder >= 2 && player.vorp != null && player.vorp >= 0) {
        add(`Standalone value (${player.position}${player.depthChartOrder})`, 12);
        reasons.push(`Standalone value (${player.position}${player.depthChartOrder})`);
      }
      if (!player.team && player.position !== "DEF") {
        const namesake = `${normalizeName(player.fullName)}|${normalizePos(player.position) ?? ""}`;
        if (rosteredNamesake.has(namesake)) {
          add("Free agent namesake", -400);
          reasons.push("Free agent");
        }
      }
      if (isSevereInjury(player.injuryStatus)) {
        add(player.injuryStatus, -40);
        reasons.push(player.injuryStatus);
      }
      if (queued.has(player.id)) {
        add("On your queue", 20);
        reasons.unshift("On your queue");
      }
      if (reasons.length === 0) {
        reasons.push("Best available");
      }
      return {
        player,
        score,
        reason: reasons[0] ?? "Best available",
        reasons,
        breakdown,
        survivalProbability: survival
      };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return rankOf(a.player) - rankOf(b.player);
    });
    return scored.slice(0, limit);
  }
  function suggestionSet(recs, limit = 5) {
    if (recs.length <= 1) return recs.slice(0, limit);
    const featured = recs[0];
    const chosen = [featured];
    const used = /* @__PURE__ */ new Set([featured.player.id]);
    const leftover = () => recs.filter((rec) => !used.has(rec.player.id));
    const take = (rec) => {
      if (!rec || used.has(rec.player.id) || chosen.length >= limit) return;
      used.add(rec.player.id);
      chosen.push(rec);
    };
    take(leftover().find((rec) => rec.player.position !== featured.player.position));
    take(
      leftover().filter((rec) => rec.survivalProbability != null && rec.survivalProbability < 0.5).sort((a, b) => (a.survivalProbability ?? 1) - (b.survivalProbability ?? 1))[0]
    );
    take(leftover().find((rec) => rec.reasons.some((reason) => reason.startsWith("Open bye "))));
    const usedPositions = new Set(chosen.map((rec) => rec.player.position));
    for (const rec of leftover()) {
      if (chosen.length >= limit) break;
      if (usedPositions.has(rec.player.position)) continue;
      take(rec);
      usedPositions.add(rec.player.position);
    }
    for (const rec of leftover()) take(rec);
    return chosen;
  }

  // src/extension/overlayRoom.ts
  var NEED_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
  var SUMMARY_KEYS = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", "BN"];
  function overlayRoom(options) {
    const {
      players,
      picks,
      slots,
      yourSlot,
      order,
      teams,
      rounds,
      type,
      pickOwners,
      currentPickNo
    } = options;
    const playerById = new Map(players.map((player) => [player.id, player]));
    const yourPlayers = picks.filter((pick) => pick.draftSlot === yourSlot).map((pick) => playerById.get(pick.playerId)).filter((player) => Boolean(player));
    const filled = fillRoster(slots, yourPlayers);
    const roster = filled.map((slot) => ({
      key: slot.key,
      label: slot.label,
      name: slot.player?.fullName ?? null,
      position: slot.player?.position ?? null,
      team: slot.player?.team ?? null,
      playerId: slot.player?.id ?? null
    }));
    const drafted = roster.filter((slot) => slot.playerId).length;
    const openFlex = filled.some((slot) => slot.key === "FLEX" && !slot.player);
    const needs = NEED_POSITIONS.filter((position) => slots[position] > 0).map((position) => {
      const total = slots[position];
      const taken = filled.filter((slot) => slot.key === position && slot.player).length;
      const flexHelp = (position === "RB" || position === "WR" || position === "TE") && openFlex;
      return {
        position,
        filled: taken,
        total,
        open: Math.max(0, total - taken),
        tone: taken < total ? "high" : flexHelp ? "med" : "low"
      };
    });
    const summary = SUMMARY_KEYS.filter((key) => slots[key] > 0).map((key) => {
      const total = slots[key];
      const taken = filled.filter((slot) => slot.key === key && slot.player).length;
      return {
        key,
        label: key === "SUPER_FLEX" ? "SF" : key,
        filled: taken,
        total,
        open: Math.max(0, total - taken)
      };
    });
    const byRoundSlot = /* @__PURE__ */ new Map();
    for (const pick of picks) {
      if (pick.pickNo < 1) continue;
      byRoundSlot.set(`${pick.round}-${pick.draftSlot}`, pick);
    }
    const boardTeams = order.map((slot) => ({
      slot: slot.slot,
      name: slot.teamName || slot.displayName,
      abbrev: teamAbbrev(slot.teamName || slot.displayName, slot.slot),
      you: slot.isYou
    }));
    const cells = [];
    for (let round = 1; round <= rounds; round += 1) {
      for (const slot of order) {
        const pickNo = pickNumberFor(round, slot.slot, teams, type, pickOwners);
        const pick = byRoundSlot.get(`${round}-${slot.slot}`) ?? picks.find((entry) => entry.pickNo === pickNo);
        const player = pick ? playerById.get(pick.playerId) : void 0;
        cells.push({
          round,
          slot: slot.slot,
          pickNo,
          name: displayName(player, pick),
          last: lastName(player, pick),
          position: player?.position ?? pick?.meta?.position ?? null,
          team: player?.team ?? pick?.meta?.team ?? null,
          playerId: player?.id ?? pick?.playerId ?? null,
          current: !pick && pickNo === currentPickNo,
          yours: slot.slot === yourSlot,
          keeper: Boolean(pick?.isKeeper)
        });
      }
    }
    return {
      roster,
      drafted,
      needs,
      summary,
      board: { teams: boardTeams, rounds, currentPickNo, cells }
    };
  }
  function teamAbbrev(name, slot) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const initials = `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
      if (initials.length === 2) return initials;
    }
    const compact = name.replace(/[^A-Za-z0-9]/g, "");
    return (compact.slice(0, 3) || `T${slot}`).toUpperCase();
  }
  function displayName(player, pick) {
    if (player?.fullName) return player.fullName;
    if (!pick?.meta) return null;
    const combined = `${pick.meta.firstName} ${pick.meta.lastName}`.trim();
    return combined || null;
  }
  function lastName(player, pick) {
    if (player?.lastName) return player.lastName;
    if (pick?.meta?.lastName) return pick.meta.lastName;
    const full = displayName(player, pick);
    if (!full) return null;
    return full.split(/\s+/).filter(Boolean).slice(-1)[0] ?? full;
  }

  // src/extension/playerValuations.ts
  function valuationFor(player) {
    const valuation = {};
    let useful = false;
    const put = (key, value) => {
      if (value == null) return;
      valuation[key] = value;
      useful = true;
    };
    put("adp", player.adp);
    put("liveAdp", player.liveAdp);
    put("vorp", player.vorp);
    put("projectedPoints", player.projectedPoints);
    put("tier", player.tier);
    put("rankStdDev", player.rankStdDev);
    put("rankLow", player.rankLow);
    put("rankHigh", player.rankHigh);
    put("depthChartOrder", player.depthChartOrder);
    put("bye", player.bye);
    return useful ? valuation : null;
  }
  function buildValuations(players, leagueId, season, limit = 600) {
    const ordered = [...players].sort((a, b) => {
      const left = a.liveAdp ?? a.adp ?? (a.searchRank > 0 ? a.searchRank : 9999);
      const right = b.liveAdp ?? b.adp ?? (b.searchRank > 0 ? b.searchRank : 9999);
      return left - right;
    });
    const table = {};
    let kept = 0;
    for (const player of ordered) {
      if (kept >= limit) break;
      const id = player.espnId ?? player.id;
      if (!id) continue;
      const valuation = valuationFor(player);
      if (!valuation) continue;
      table[String(id)] = valuation;
      kept += 1;
    }
    return { leagueId, season, updatedAt: Date.now(), players: table };
  }
  function applyValuations(players, table) {
    const valuations = table?.players;
    if (!valuations) return players;
    return players.map((player) => {
      const valuation = valuations[player.id];
      return valuation ? { ...player, ...valuation } : player;
    });
  }
  return __toCommonJS(core_exports);
})();
