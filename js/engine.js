/**
 * Canasta table. Classic mode is Bicycle / Pagat, a match of four hands:
 * 2 players draw two and need two canastas; 3 play cutthroat; 4 play as partners.
 *
 * House rules are four hands, everyone alone. The pack is (players + 1) decks.
 * Each player has a hand and a foot of 13 and draws two cards. The opening count
 * is 50, then 90, then 120, then 150. The discard pile can be taken only when
 * its top card starts a new meld. A finished canasta is frozen, and another
 * meld of that rank can be started once it is complete. Going out takes a pure canasta,
 * a mixed canasta, and a wild canasta, then an empty hand and foot.
 *
 * State is mutated in place. apply() returns {ok:true} or {ok:false, error}.
 */

export const HANDS_PER_MATCH = 4
export const WILD_RANK = -1
export const WILD_CANASTA = 1500

const RANK_NAME = {
  [-1]: "Wild",
  0: "Joker",
  1: "Ace",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
  11: "Jack",
  12: "Queen",
  13: "King",
}

const SUIT_NAME = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
  r: "red",
  b: "black",
}

const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣", r: "★", b: "★" }

export function rankLabel(card) {
  if (card.rank === 0) return "J"
  if (card.rank === 1) return "A"
  if (card.rank === 11) return "J"
  if (card.rank === 12) return "Q"
  if (card.rank === 13) return "K"
  return String(card.rank)
}

export function suitSymbol(card) {
  return SUIT_SYMBOL[card.suit] || ""
}

export function cardName(card) {
  if (card.rank === 0) return card.suit === "r" ? "Red Joker" : "Black Joker"
  return `${RANK_NAME[card.rank]} of ${SUIT_NAME[card.suit]}`
}

export function cardPoints(card) {
  if (card.rank === 0) return 50
  if (card.rank === 1 || card.rank === 2) return 20
  if (card.rank >= 8) return 10
  return 5
}

export function isWild(card) {
  return card.rank === 0 || card.rank === 2
}

export function isRedThree(card) {
  return card.rank === 3 && (card.suit === "h" || card.suit === "d")
}

export function isBlackThree(card) {
  return card.rank === 3 && (card.suit === "s" || card.suit === "c")
}

export function isNatural(card) {
  return card.rank === 1 || card.rank >= 4
}

const HOUSE_OPENING = [50, 90, 120, 150]

export function openingRequirement(total, state) {
  if (isHouse(state)) return HOUSE_OPENING[Math.min(4, Math.max(1, state.handNumber || 1)) - 1]
  if (total < 0) return 15
  if (total < 1500) return 50
  if (total < 3000) return 90
  return 120
}

export function canastasNeeded(state) {
  return state.playerCount === 2 ? 2 : 1
}

export function isHouse(state) {
  return state?.rules === "house"
}

export function canastaBreakdown(melds) {
  const tally = { pure: 0, mixed: 0, wild: 0 }
  for (const meld of melds || []) {
    if (meld.rank === 3 || meld.cards.length < 7) continue
    if (meld.rank < 0) tally.wild += 1
    else if (meld.cards.some(isWild)) tally.mixed += 1
    else tally.pure += 1
  }
  return tally
}

export function meetsGoOut(state, melds) {
  if (!isHouse(state)) return countCanastas(melds) >= canastasNeeded(state)
  const tally = canastaBreakdown(melds)
  return tally.pure >= 1 && tally.mixed >= 1 && tally.wild >= 1
}

export function sideName(state, teamId) {
  if (!isHouse(state) && state.playerCount === 4) {
    const mates = state.players.filter((player) => player.team === teamId)
    const you = mates.find((player) => player.isHuman)
    if (you && you.name === "You") return "Your side"
    return mates.map((player) => player.name).join(" & ")
  }
  const player = state.players.find((p) => p.team === teamId)
  return player ? player.name : "Side"
}

export function sortHand(cards) {
  const order = (card) => {
    if (card.rank === 0) return 0
    if (card.rank === 2) return 1
    if (card.rank === 1) return 2
    if (card.rank === 3) return 20
    return 16 - card.rank
  }
  const suitOrder = { s: 0, h: 1, d: 2, c: 3, r: 0, b: 1 }
  return cards.slice().sort((a, b) => order(a) - order(b) || suitOrder[a.suit] - suitOrder[b.suit] || a.deck - b.deck)
}

export function describeMeld(cards, allowBlack = false, allowWild = false) {
  if (!cards || cards.length < 3) return { ok: false, error: "A meld needs at least 3 cards." }
  if (cards.length > 7) return { ok: false, error: "A canasta stops at 7 cards." }
  const wilds = cards.filter(isWild)
  const naturals = cards.filter(isNatural)
  const blacks = cards.filter(isBlackThree)
  if (cards.some(isRedThree)) return { ok: false, error: "Red threes stay on the table as bonus cards." }
  if (allowWild && cards.every(isWild)) {
    const points = cards.reduce((sum, card) => sum + cardPoints(card), 0)
    return { ok: true, rank: WILD_RANK, wild: true, black: false, points, wildCount: cards.length, pure: false }
  }
  if (blacks.length) {
    if (!allowBlack) return { ok: false, error: "Black threes can be melded only when you go out." }
    if (blacks.length !== cards.length || blacks.length > 4) {
      return { ok: false, error: "Meld 3 or 4 black threes, with no wild cards." }
    }
    return { ok: true, rank: 3, black: true, points: blacks.length * 5, wildCount: 0, pure: false }
  }
  if (naturals.length < 2) return { ok: false, error: "A meld needs at least two natural cards." }
  const rank = naturals[0].rank
  if (naturals.some((card) => card.rank !== rank)) {
    return { ok: false, error: "Natural cards in a meld must share a rank." }
  }
  if (wilds.length + naturals.length !== cards.length) return { ok: false, error: "Those cards do not form a meld." }
  if (wilds.length > 3) return { ok: false, error: "A meld can hold at most 3 wild cards." }
  const points = cards.reduce((sum, card) => sum + cardPoints(card), 0)
  return {
    ok: true,
    rank,
    black: false,
    points,
    wildCount: wilds.length,
    pure: wilds.length === 0,
  }
}

function rng(state) {
  let x = state.seed >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.seed = x >>> 0
  return state.seed / 4294967296
}

function shuffle(state, cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng(state) * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

function packCount(state) {
  return isHouse(state) ? state.playerCount + 1 : 2
}

function freshDeck(state) {
  const decks = packCount(state)
  const cards = []
  let id = 1
  for (const suit of ["s", "h", "d", "c"]) {
    for (let rank = 1; rank <= 13; rank++) {
      for (let deck = 0; deck < decks; deck++) cards.push({ id: id++, rank, suit, deck })
    }
  }
  for (let deck = 0; deck < decks; deck++) {
    cards.push({ id: id++, rank: 0, suit: "r", deck })
    cards.push({ id: id++, rank: 0, suit: "b", deck })
  }
  return shuffle(state, cards)
}

function fail(error) {
  return { ok: false, error }
}

function ok() {
  return { ok: true }
}

function say(state, text) {
  state.status = text
  state.log.push(text)
  if (state.log.length > 16) state.log.shift()
}

function actor(player) {
  return player.isHuman ? "You" : player.name
}

function act(player, you, other) {
  return player.isHuman ? you : other
}

function current(state) {
  return state.players[state.turn]
}

function teamOf(state, player = current(state)) {
  return state.teams[player.team]
}

function drawsNeeded(state) {
  if (isHouse(state) || state.playerCount === 2) return 2
  return 1
}

function handSizeFor(state) {
  if (isHouse(state)) return 13
  if (state.playerCount === 2) return 15
  if (state.playerCount === 3) return 13
  return 11
}

function hasFoot(player) {
  return !!player.foot?.length
}

function goOutMessage(state) {
  if (!isHouse(state)) {
    return canastasNeeded(state) === 2 ? "You need two canastas to go out." : "You need a canasta before you can go out."
  }
  return "You need a pure canasta, a mixed canasta, and a wild canasta before you can go out."
}

function blockEmpty(state, player, handAfter, meldsAfter) {
  if (hasFoot(player)) return null
  const ready = meetsGoOut(state, meldsAfter)
  if (ready) return null
  if (handAfter === 0) return fail(goOutMessage(state))
  if (handAfter < 2) {
    return fail(
      isHouse(state)
        ? "Keep two cards until you have a pure, a mixed, and a wild canasta."
        : "Keep two cards until your side has a canasta — one to discard, and one still in hand."
    )
  }
  return null
}

function pickupFoot(state, player) {
  if (player.hand.length || !hasFoot(player)) return false
  player.hand = player.foot
  player.foot = []
  replaceReds(state, player)
  return true
}

function meldLabel(rank) {
  return rank < 0 ? "wild cards" : `${RANK_NAME[rank].toLowerCase()}s`
}

function nextWildRank(team) {
  const ranks = team.melds.filter((meld) => meld.rank < 0).map((meld) => meld.rank)
  return ranks.length ? Math.min(...ranks) - 1 : WILD_RANK
}

export function countCanastas(melds) {
  return melds.filter((meld) => meld.rank !== 3 && meld.cards.length >= 7).length
}

function openMeld(melds, rank) {
  return melds.find((meld) => meld.rank === rank && meld.cards.length < 7)
}

function canAffordOpening(state, player, top) {
  const required = openingRequirement(state.teams[player.team].total, state)
  const house = isHouse(state)
  const hand = player.hand
  const wilds = hand.filter(isWild).sort((a, b) => cardPoints(b) - cardPoints(a))
  const groups = new Map()
  for (const card of hand) {
    if (!isNatural(card)) continue
    if (!groups.has(card.rank)) groups.set(card.rank, [])
    groups.get(card.rank).push(card)
  }
  if ((groups.get(top.rank) || []).length < 2) return false
  const rest = state.discard.slice(0, -1).filter((card) => !isRedThree(card)).length
  const foot = hasFoot(player)
  const ranks = [...groups.keys()].sort((a, b) => (a === top.rank ? -1 : b === top.rank ? 1 : a - b))
  const wildPoints = wilds.map(cardPoints)
  let nodes = 0
  let found = false

  function legal(usedCards, points, melds) {
    if (points < required) return false
    const handAfter = hand.length - usedCards + rest
    if (foot || handAfter >= 2) return true
    return handAfter === 0 && meetsGoOut(state, melds)
  }

  function walk(index, wildUsed, usedCards, points, melds) {
    if (found || ++nodes > 20000) return
    const rank = ranks[index]
    const isTop = rank === top.rank
    if (isTop && points >= required && (foot || rest >= 2)) {
      found = true
      return
    }
    if (!isTop && legal(usedCards, points, melds)) {
      found = true
      return
    }
    if (index === ranks.length) {
      const left = wilds.length - wildUsed
      if (house && left >= 3) {
        const take = Math.min(left, 7)
        const extra = wildPoints.slice(wildUsed, wildUsed + take).reduce((sum, value) => sum + value, 0)
        const wildMeld = { rank: -1, cards: wilds.slice(wildUsed, wildUsed + take) }
        if (legal(usedCards + take, points + extra, melds.concat([wildMeld]))) found = true
      }
      return
    }
    let ceiling = points
    for (let later = index; later < ranks.length; later++) {
      const laterRank = ranks[later]
      const laterCards = groups.get(laterRank)
      const laterTop = laterRank === top.rank
      const count = Math.min(laterCards.length, laterTop ? 6 : 7)
      if (count < 2) continue
      if (laterTop) ceiling += cardPoints(top)
      ceiling += laterCards.slice(0, count).reduce((sum, card) => sum + cardPoints(card), 0)
    }
    ceiling += wildPoints.slice(wildUsed).reduce((sum, value) => sum + value, 0)
    if (ceiling < required) return

    if (!isTop) walk(index + 1, wildUsed, usedCards, points, melds)
    const cards = groups.get(rank)
    const wildLeft = wilds.length - wildUsed
    const maxNatural = Math.min(cards.length, isTop ? 6 : 7)
    for (let count = 2; count <= maxNatural; count++) {
      const naturalPoints = cards.slice(0, count).reduce((sum, card) => sum + cardPoints(card), 0)
      const length = count + (isTop ? 1 : 0)
      const maxWild = Math.min(3, wildLeft, 7 - length)
      const minWild = length >= 3 ? 0 : 1
      if (minWild > maxWild) continue
      for (let wildCount = minWild; wildCount <= maxWild; wildCount++) {
        const wildScore = wildPoints.slice(wildUsed, wildUsed + wildCount).reduce((sum, value) => sum + value, 0)
        const meldCards = cards.slice(0, count).concat(wilds.slice(wildUsed, wildUsed + wildCount))
        if (isTop) meldCards.push(top)
        walk(
          index + 1,
          wildUsed + wildCount,
          usedCards + count + wildCount,
          points + naturalPoints + (isTop ? cardPoints(top) : 0) + wildScore,
          melds.concat([{ rank, cards: meldCards }])
        )
        if (found) return
      }
    }
  }

  walk(0, 0, 0, 0, [])
  if (!found && nodes > 20000) return true
  return found
}

export function discardInfo(state, playerIndex = state.turn) {
  const player = state.players[playerIndex]
  const team = state.teams[player.team]
  const top = state.discard[state.discard.length - 1] || null
  const frozenGlobal = state.discard.some((card) => isWild(card) || isRedThree(card))
  const frozen = frozenGlobal || !team.opened
  const info = {
    top,
    frozen,
    frozenGlobal,
    canTake: false,
    mustTake: false,
    mode: "no",
    reason: "You cannot take the discard.",
  }
  if (!top) {
    info.reason = "There is nothing in the discard pile."
    return info
  }
  if (isWild(top)) {
    info.reason = "A wild card is on top. Cover it before the pile can be taken."
    return info
  }
  if (isBlackThree(top)) {
    info.reason = "A black three blocks the discard pile."
    return info
  }
  if (isRedThree(top)) {
    info.reason = "A red three cannot be taken."
    return info
  }
  if (player.hand.length === 1 && state.discard.length === 1) {
    info.reason = "A one-card hand cannot take a one-card discard pile."
    return info
  }
  const naturals = player.hand.filter((card) => card.rank === top.rank)
  const wilds = player.hand.filter(isWild)
  const existing = openMeld(team.melds, top.rank)
  if (isHouse(state) && existing) {
    info.reason = "That card matches a meld you already have. Take a discard only when it starts a new meld."
    return info
  }
  if (existing && frozen && existing.cards.length + 3 > 7) {
    info.reason = "A canasta stops at 7 cards."
    return info
  }
  if (!frozen && existing) {
    info.canTake = true
    info.mode = "layoff"
    info.mustTake = state.stock.length === 0
    info.reason = "You can add that discard to your meld."
    return info
  }
  if (naturals.length >= 2) {
    if (!team.opened && !canAffordOpening(state, player, top)) {
      const required = openingRequirement(team.total, state)
      info.reason = `Opening meld needs ${required} points. That discard does not get you there.`
      return info
    }
    info.canTake = true
    info.mode = "pair"
    info.reason = frozen
      ? "The pile is frozen. A natural pair from your hand can take it."
      : "A natural pair can take the discard."
    return info
  }
  if (!frozen && naturals.length >= 1 && wilds.length >= 1) {
    info.canTake = true
    info.mode = "wild"
    info.reason = "You can meld that discard with a match and a wild card."
    return info
  }
  if (!team.opened) info.reason = `You have not opened. You need two natural ${RANK_NAME[top.rank].toLowerCase()}s to take the pile.`
  else if (frozen) info.reason = `The pile is frozen. You need two natural ${RANK_NAME[top.rank].toLowerCase()}s.`
  else info.reason = "You need a matching pair, or one match and a wild card."
  return info
}

export function freezeCard(state) {
  return state.discard.find((card) => isWild(card) || isRedThree(card)) || null
}

function pull(hand, ids) {
  const want = new Set(ids)
  if (want.size !== ids.length) return { ok: false, error: "Each card can be used only once." }
  const taken = []
  for (const id of ids) {
    const card = hand.find((item) => item.id === id)
    if (!card) return { ok: false, error: "Those cards are not all in your hand." }
    taken.push(card)
  }
  return { ok: true, cards: taken }
}

function snapshot(state) {
  const turnState = state.turnState
  if (!turnState) return
  turnState.snapshot = null
  const copy = structuredClone(state)
  if (copy.turnState) copy.turnState.snapshot = null
  turnState.snapshot = copy
}

function beginMeld(state, extra = {}) {
  const player = current(state)
  const team = teamOf(state)
  const initialRanks = extra.initialRanks || team.melds.map((meld) => meld.rank)
  state.turnState = {
    drewFromStock: !!extra.drewFromStock,
    tookPile: !!extra.tookPile,
    laidOff: !!extra.laidOff,
    madeCanasta: !!extra.madeCanasta,
    hadMelded: extra.hadMelded ?? player.hasMelded,
    initialRanks,
    snapshot: null,
  }
  state.phase = "meld"
  state.mustTake = false
  state.mayDecline = false
  snapshot(state)
}

function isConcealed(state) {
  const turnState = state.turnState
  if (!turnState || turnState.hadMelded || turnState.laidOff || !turnState.madeCanasta) return false
  return current(state).hand.length === 0
}

export function evaluateScores(state) {
  return state.teams.map((team, teamId) => {
    let natural = 0
    let mixed = 0
    let wild = 0
    let melded = 0
    for (const meld of team.melds) {
      melded += meld.cards.reduce((sum, card) => sum + cardPoints(card), 0)
    if (meld.rank === 3 || meld.cards.length < 7) continue
    if (meld.rank < 0) wild += 1
      else if (meld.cards.some(isWild)) mixed += 1
      else natural += 1
    }
    const opened = team.melds.length > 0
    const reds = team.redThrees.length
    const packReds = packCount(state) * 2
    let redScore = reds === packReds && reds > 0 ? reds * 200 : reds * 100
    if (!opened) redScore = -redScore
    let going = 0
    if (state.out && state.players[state.out.player].team === teamId) {
      going = state.out.concealed ? 200 : 100
    }
    let penalty = 0
    for (const player of state.players) {
      if (player.team !== teamId) continue
      penalty += player.hand.reduce((sum, card) => sum + cardPoints(card), 0)
      penalty += (player.foot || []).reduce((sum, card) => sum + cardPoints(card), 0)
    }
    const delta = natural * 500 + mixed * 300 + wild * WILD_CANASTA + redScore + going + melded - penalty
    return {
      team: teamId,
      name: sideName(state, teamId),
      natural,
      mixed,
      wild,
      reds,
      redScore,
      going,
      melded,
      penalty,
      delta,
      concealed: !!(state.out && state.out.concealed && state.players[state.out.player].team === teamId),
    }
  })
}

function endHand(state, reason) {
  if (state.phase === "handEnd" || state.phase === "matchEnd") return
  const lines = evaluateScores(state).map((line) => {
    state.teams[line.team].total += line.delta
    return { ...line, total: state.teams[line.team].total }
  })
  state.endReason = reason
  state.handSummary = {
    hand: state.handNumber,
    reason,
    outName: state.out ? state.players[state.out.player].name : null,
    concealed: !!state.out?.concealed,
    lines,
  }
  state.history.push(state.handSummary)
  state.phase = state.handNumber >= HANDS_PER_MATCH ? "matchEnd" : "handEnd"
  state.turnState = null
  state.mustTake = false
  state.mayDecline = false
}

function finishOut(state) {
  state.out = { player: state.turn, concealed: isConcealed(state) }
  endHand(state, "out")
}

function absorbRest(state, player, team) {
  const rest = state.discard
  state.discard = []
  for (const card of rest) {
    if (isRedThree(card)) team.redThrees.push(card)
    else player.hand.push(card)
  }
}

function replaceReds(state, player) {
  const team = state.teams[player.team]
  let guard = 0
  while (guard++ < 40) {
    const index = player.hand.findIndex(isRedThree)
    if (index < 0) return
    team.redThrees.push(player.hand.splice(index, 1)[0])
    if (!state.stock.length) continue
    player.hand.push(state.stock.pop())
  }
}

function prepareTurn(state) {
  state.phase = "draw"
  state.turnState = null
  state.mustTake = false
  state.mayDecline = false
  if (state.stock.length > 0) return
  const info = discardInfo(state)
  if (!info.canTake) {
    say(state, `The stock is empty and ${actor(current(state))} cannot take the discard. The hand ends.`)
    endHand(state, "stock")
    return
  }
  if (info.mustTake) {
    say(state, `The stock is empty. ${actor(current(state))} must take the ${cardName(info.top)}.`)
    const result = commitLayoffTake(state)
    if (!result.ok) endHand(state, "stock")
    return
  }
  state.mayDecline = true
  say(state, "The stock is empty. Take the discard or end the hand.")
}

function advanceTurn(state) {
  state.turn = (state.turn + 1) % state.playerCount
  prepareTurn(state)
}

export function createMatch({ opponents = 3, seed = 1, rules = "classic" } = {}) {
  const house = rules === "house"
  const playerCount = opponents + 1
  if (playerCount < 2 || playerCount > 4) throw new Error("Choose 1, 2, or 3 AI opponents.")
  const names =
    playerCount === 2 ? ["You", "Mina"] : playerCount === 3 ? ["You", "Mina", "Ellis"] : ["You", "Mina", "Ellis", "Noah"]
  const players = names.map((name, index) => ({
    name,
    isHuman: index === 0,
    team: !house && playerCount === 4 ? index % 2 : index,
    hand: [],
    foot: [],
    hasMelded: false,
  }))
  const teamCount = !house && playerCount === 4 ? 2 : playerCount
  const state = {
    seed: seed >>> 0 || 1,
    rules: house ? "house" : "classic",
    playerCount,
    handNumber: 0,
    dealer: 0,
    turn: 0,
    phase: "new",
    stock: [],
    discard: [],
    players,
    teams: Array.from({ length: teamCount }, () => ({ total: 0, melds: [], redThrees: [], opened: false })),
    turnState: null,
    mustTake: false,
    mayDecline: false,
    out: null,
    endReason: null,
    status: "New match.",
    log: [],
    history: [],
    handSummary: null,
  }
  state.dealer = Math.floor(rng(state) * playerCount)
  return state
}

function dealHand(state) {
  if (state.phase !== "new" && state.phase !== "handEnd") return fail("The next hand is not ready.")
  if (state.handNumber >= HANDS_PER_MATCH) {
    state.phase = "matchEnd"
    return ok()
  }
  state.handNumber += 1
  if (state.handNumber > 1) state.dealer = (state.dealer + 1) % state.playerCount
  for (const player of state.players) {
    player.hand = []
    player.foot = []
    player.hasMelded = false
  }
  for (const team of state.teams) {
    team.melds = []
    team.redThrees = []
    team.opened = false
  }
  state.discard = []
  state.out = null
  state.endReason = null
  state.handSummary = null
  state.stock = freshDeck(state)
  const size = handSizeFor(state)
  let seat = (state.dealer + 1) % state.playerCount
  for (let i = 0; i < size * state.playerCount; i++) {
    state.players[seat].hand.push(state.stock.pop())
    seat = (seat + 1) % state.playerCount
  }
  if (isHouse(state)) {
    seat = (state.dealer + 1) % state.playerCount
    for (let i = 0; i < size * state.playerCount; i++) {
      state.players[seat].foot.push(state.stock.pop())
      seat = (seat + 1) % state.playerCount
    }
  }
  while (state.stock.length) {
    const card = state.stock.pop()
    state.discard.push(card)
    if (!isWild(card) && !isRedThree(card)) break
  }
  seat = (state.dealer + 1) % state.playerCount
  for (let i = 0; i < state.playerCount; i++) {
    replaceReds(state, state.players[seat])
    seat = (seat + 1) % state.playerCount
  }
  state.turn = (state.dealer + 1) % state.playerCount
  const reqs = isHouse(state)
    ? String(openingRequirement(0, state))
    : state.teams.map((team) => openingRequirement(team.total, state)).join(" / ")
  const dealer = state.players[state.dealer]
  const dealt = `${actor(dealer)} ${act(dealer, "deal", "deals")}. Opening count: ${reqs}.`
  const houseNote = isHouse(state) ? `House rules, ${packCount(state)} decks. ` : ""
  say(state, `Hand ${state.handNumber} of ${HANDS_PER_MATCH}. ${houseNote}${dealt}`)
  prepareTurn(state)
  return ok()
}

function draw(state) {
  if (state.phase !== "draw") return fail("You have already drawn.")
  if (state.mustTake) return fail("The stock is empty. You have to take the discard.")
  if (!state.stock.length) return fail("The stock is empty.")
  const player = current(state)
  const team = teamOf(state)
  const need = drawsNeeded(state)
  let got = 0
  let reds = 0
  while (got < need) {
    if (!state.stock.length) break
    const card = state.stock.pop()
    if (isRedThree(card)) {
      team.redThrees.push(card)
      reds += 1
      if (!state.stock.length && got === 0) {
        say(state, `${actor(player)} ${act(player, "draw", "draws")} the last card, a red three. The hand ends.`)
        endHand(state, "red3")
        return ok()
      }
      continue
    }
    player.hand.push(card)
    got += 1
  }
  if (got === 0) {
    say(state, "The stock is empty. The hand ends.")
    endHand(state, "stock")
    return ok()
  }
  beginMeld(state, { drewFromStock: true })
  const noun = got === 1 ? "a card" : "two cards"
  say(
    state,
    reds
      ? `${actor(player)} ${act(player, "lay", "lays")} down a red three and ${act(player, "draw", "draws")} ${noun}.`
      : `${actor(player)} ${act(player, "draw", "draws")} ${noun}.`
  )
  return ok()
}

function commitLayoffTake(state) {
  const player = current(state)
  const team = teamOf(state)
  const hadMelded = player.hasMelded
  const initialRanks = team.melds.map((meld) => meld.rank)
  const top = state.discard.pop()
  const meld = openMeld(team.melds, top.rank)
  if (!meld) {
    state.discard.push(top)
    return fail(team.melds.some((item) => item.rank === top.rank) ? "That canasta is complete." : "You have no meld of that rank.")
  }
  const before = meld.cards.length
  if (before >= 7) {
    state.discard.push(top)
    return fail("That canasta is complete.")
  }
  const parsed = describeMeld([...meld.cards, top])
  if (!parsed.ok) {
    state.discard.push(top)
    return fail(parsed.error)
  }
  meld.cards.push(top)
  absorbRest(state, player, team)
  player.hasMelded = true
  const madeCanasta = before < 7 && meld.cards.length >= 7
  beginMeld(state, { tookPile: true, laidOff: true, madeCanasta, hadMelded, initialRanks })
  if (!player.hand.length && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "take", "takes")} the discard pile and ${act(player, "pick up the foot", "picks up the foot")}.`)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "take", "takes")} the discard pile.`)
  if (!player.hand.length) finishOut(state)
  return ok()
}

function commitGroupedTake(state, groups) {
  const player = current(state)
  const team = teamOf(state)
  const info = discardInfo(state)
  const top = info.top
  if (!groups.length) return fail("Choose the cards that meld with the discard.")
  const allIds = groups.flat()
  const pulled = pull(player.hand, allIds)
  if (!pulled.ok) return fail(pulled.error)
  const chunks = groups.map((ids) => ids.map((id) => player.hand.find((card) => card.id === id)))
  const matching = chunks.filter((cards) => cards.some((card) => isNatural(card) && card.rank === top.rank))
  if (matching.length !== 1) return fail(`Include natural ${RANK_NAME[top.rank].toLowerCase()}s from your hand.`)
  const match = matching[0]
  const matchNaturals = match.filter((card) => isNatural(card) && card.rank === top.rank)
  if (match.some((card) => isNatural(card) && card.rank !== top.rank)) {
    return fail("Each meld can contain only one rank.")
  }
  if (info.frozen && matchNaturals.length < 2) return fail("A frozen pile needs two natural cards from your hand.")
  if (!info.frozen && matchNaturals.length < 2 && !match.some(isWild)) {
    return fail("Use two natural cards, or one natural card and a wild card.")
  }

  const hadMelded = player.hasMelded
  const initialRanks = team.melds.map((meld) => meld.rank)
  const built = []
  for (const cards of chunks) {
    const withTop = cards === match ? [...cards, top] : cards
    const parsed = describeMeld(withTop, false, isHouse(state))
    if (!parsed.ok) return fail(parsed.error)
    if (built.some((meld) => meld.rank === parsed.rank)) return fail("Only one meld of each rank.")
    const existing = openMeld(team.melds, parsed.rank)
    if (existing) {
      if (existing.cards.length + withTop.length > 7) return fail("A canasta stops at 7 cards.")
      const merged = describeMeld([...existing.cards, ...withTop], false, isHouse(state))
      if (!merged.ok) return fail(merged.error)
    }
    built.push({ rank: parsed.rank, cards: withTop, points: parsed.points, merge: !!existing })
  }

  if (!team.opened) {
    const points = built.reduce((sum, meld) => sum + meld.points, 0)
    const required = openingRequirement(team.total, state)
    if (points < required) {
      return fail(`Opening meld needs ${required} points. With the discard, that selection is ${points}.`)
    }
  }

  const rest = state.discard.slice(0, -1).filter((card) => !isRedThree(card))
  const handAfter = player.hand.length - allIds.length + rest.length
  const meldsAfter = team.melds.map((meld) => ({ rank: meld.rank, cards: meld.cards.slice() }))
  for (const meld of built) {
    if (meld.merge) openMeld(meldsAfter, meld.rank).cards.push(...meld.cards)
    else meldsAfter.push({ rank: meld.rank, cards: meld.cards })
  }
  const blocked = blockEmpty(state, player, handAfter, meldsAfter)
  if (blocked) return blocked

  player.hand = player.hand.filter((card) => !allIds.includes(card.id))
  let madeCanasta = false
  let laidOff = false
  for (const meld of built) {
    if (meld.merge) {
      const existing = openMeld(team.melds, meld.rank)
      const before = existing.cards.length
      existing.cards.push(...meld.cards)
      if (before < 7 && existing.cards.length >= 7) madeCanasta = true
      if (initialRanks.includes(meld.rank)) laidOff = true
    } else {
      team.melds.push({ rank: meld.rank, cards: meld.cards })
      if (meld.cards.length >= 7) madeCanasta = true
    }
  }
  state.discard.pop()
  absorbRest(state, player, team)
  team.opened = true
  player.hasMelded = true
  beginMeld(state, { tookPile: true, laidOff, madeCanasta, hadMelded, initialRanks })
  if (!player.hand.length && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "take", "takes")} the discard pile and ${act(player, "pick up the foot", "picks up the foot")}.`)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "take", "takes")} the discard pile.`)
  if (!player.hand.length) finishOut(state)
  return ok()
}

function take(state, groups = []) {
  if (state.phase !== "draw") return fail("You can pick up the discard only at the start of your turn.")
  const info = discardInfo(state)
  if (!info.canTake) return fail(info.reason)
  const team = teamOf(state)
  if (info.mode === "layoff" && !groups.length) return commitLayoffTake(state)
  if (info.mode === "layoff" && groups.length) return fail("Take the pile first. You can meld other cards afterward.")
  if (team.opened && groups.length !== 1) return fail("Choose the one meld that uses the discard.")
  return commitGroupedTake(state, groups)
}

function open(state, groups = [], discardId = null) {
  if (state.phase !== "meld") return fail("Draw before you meld.")
  const player = current(state)
  const team = teamOf(state)
  if (team.opened) return fail("Your side has already opened.")
  if (!state.turnState) return fail("Draw before you meld.")
  if (!groups.length) return fail("Choose cards to meld.")
  const allIds = groups.flat()
  const pulled = pull(player.hand, allIds)
  if (!pulled.ok) return fail(pulled.error)
  if (discardId != null && allIds.includes(discardId)) return fail("That card cannot be both melded and discarded.")
  if (discardId != null && !player.hand.some((card) => card.id === discardId)) return fail("That card is not in your hand.")
  const discardCard = discardId == null ? null : player.hand.find((card) => card.id === discardId)
  if (discardCard && isRedThree(discardCard)) return fail("Red threes are not discarded.")
  const leftover = player.hand.filter((card) => !allIds.includes(card.id) && card.id !== discardId)
  if (discardId != null && leftover.length) return fail("When you go out, every other card has to be melded.")

  const built = []
  for (const ids of groups) {
    const cards = ids.map((id) => player.hand.find((card) => card.id === id))
    const parsed = describeMeld(cards, false, isHouse(state))
    if (!parsed.ok) return fail(parsed.error)
    if (built.some((meld) => meld.rank === parsed.rank)) return fail("Only one meld of each rank.")
    built.push({ rank: parsed.rank, cards, points: parsed.points })
  }
  const points = built.reduce((sum, meld) => sum + meld.points, 0)
  const required = openingRequirement(team.total, state)
  const handAfter = leftover.length
  const projected = built.map((meld) => ({ rank: meld.rank, cards: meld.cards }))
  const ready = meetsGoOut(state, projected)
  const goingOut = handAfter === 0 && !hasFoot(player)
  const waiver =
    goingOut && state.turnState.drewFromStock && !state.turnState.hadMelded && !state.turnState.laidOff && ready
  if (points < required && !waiver) {
    return fail(`Opening meld needs ${required} points. That selection is ${points}.`)
  }
  const blocked = blockEmpty(state, player, handAfter, projected)
  if (blocked) return blocked

  player.hand = leftover.slice()
  for (const meld of built) team.melds.push({ rank: meld.rank, cards: meld.cards })
  team.opened = true
  player.hasMelded = true
  if (projected.some((meld) => meld.rank !== 3 && meld.cards.length >= 7)) state.turnState.madeCanasta = true
  if (discardCard) state.discard.push(discardCard)
  if (!player.hand.length && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "open", "opens")} for ${points} and ${act(player, "pick up the foot", "picks up the foot")}.`)
    if (discardCard) advanceTurn(state)
    return ok()
  }
  if (goingOut) {
    if (points < required) say(state, `${actor(player)} ${act(player, "go", "goes")} out concealed.`)
    else say(state, `${actor(player)} ${act(player, "open", "opens")} for ${points} and ${act(player, "go", "goes")} out.`)
    finishOut(state)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "open", "opens")} for ${points} points.`)
  return ok()
}

function meld(state, cardIds) {
  if (state.phase !== "meld") return fail("Draw before you meld.")
  const player = current(state)
  const team = teamOf(state)
  if (!team.opened) return fail("Meet the opening count before playing other melds.")
  const pulled = pull(player.hand, cardIds)
  if (!pulled.ok) return fail(pulled.error)
  const parsed = describeMeld(pulled.cards, false, isHouse(state))
  if (!parsed.ok) return fail(parsed.error)
  const rank = parsed.rank === WILD_RANK ? nextWildRank(team) : parsed.rank
  if (parsed.rank === WILD_RANK) {
    if (team.melds.some((meld) => meld.rank < 0 && meld.cards.length < 7)) {
      return fail("Add those wild cards to your wild meld.")
    }
  } else if (openMeld(team.melds, parsed.rank)) {
    return fail("You already have that rank. Add to the meld.")
  }
  const handAfter = player.hand.length - cardIds.length
  const meldsAfter = team.melds.concat([{ rank, cards: pulled.cards }])
  const blocked = blockEmpty(state, player, handAfter, meldsAfter)
  if (blocked) return blocked
  player.hand = player.hand.filter((card) => !cardIds.includes(card.id))
  team.melds.push({ rank, cards: pulled.cards })
  player.hasMelded = true
  if (pulled.cards.length >= 7) state.turnState.madeCanasta = true
  const label = meldLabel(rank)
  if (!player.hand.length && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "meld", "melds")} ${label} and ${act(player, "pick up the foot", "picks up the foot")}.`)
    return ok()
  }
  if (!player.hand.length) {
    say(state, `${actor(player)} ${act(player, "meld", "melds")} and ${act(player, "go", "goes")} out.`)
    finishOut(state)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "meld", "melds")} ${label}.`)
  return ok()
}

function layoff(state, cardIds, rank) {
  if (state.phase !== "meld") return fail("Draw before you meld.")
  const player = current(state)
  const team = teamOf(state)
  if (!team.opened) return fail("Open before adding to a meld.")
  const pulled = pull(player.hand, cardIds)
  if (!pulled.ok) return fail(pulled.error)
  const naturals = pulled.cards.filter(isNatural)
  if (pulled.cards.some(isRedThree) || pulled.cards.some(isBlackThree)) {
    return fail("Threes cannot be added to a meld.")
  }
  if (naturals.length && naturals.some((card) => card.rank !== naturals[0].rank)) {
    return fail("Add cards of a single rank.")
  }
  const meldRank = naturals.length ? naturals[0].rank : rank
  if (meldRank == null) return fail("Choose which meld gets the wild card.")
  if (naturals.length && rank != null && rank !== meldRank) return fail("Those cards do not match that meld.")
  let meld = openMeld(team.melds, meldRank)
  if (!meld && meldRank < 0 && !team.melds.some((item) => item.rank === meldRank)) {
    meld = team.melds.find((item) => item.rank < 0 && item.cards.length < 7)
  }
  if (!meld) {
    const finished = team.melds.some((item) => item.rank === meldRank)
    return fail(finished ? "That canasta is complete." : "You have no meld of that rank.")
  }
  if (meld.cards.length + pulled.cards.length > 7) return fail("A canasta stops at 7 cards.")
  const parsed = describeMeld([...meld.cards, ...pulled.cards], false, isHouse(state))
  if (!parsed.ok) return fail(parsed.error)
  const before = meld.cards.length
  const handAfter = player.hand.length - cardIds.length
  const meldsAfter = team.melds.map((item) =>
    item === meld ? { rank: item.rank, cards: [...item.cards, ...pulled.cards] } : item
  )
  const blocked = blockEmpty(state, player, handAfter, meldsAfter)
  if (blocked) return blocked
  player.hand = player.hand.filter((card) => !cardIds.includes(card.id))
  meld.cards.push(...pulled.cards)
  player.hasMelded = true
  if (state.turnState.initialRanks?.includes(meldRank)) state.turnState.laidOff = true
  if (before < 7 && meld.cards.length >= 7) state.turnState.madeCanasta = true
  if (!player.hand.length && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "add", "adds")} to the ${meldLabel(meldRank)} and ${act(player, "pick up the foot", "picks up the foot")}.`)
    return ok()
  }
  if (!player.hand.length) {
    say(state, `${actor(player)} ${act(player, "go", "goes")} out.`)
    finishOut(state)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "add", "adds")} to the ${meldLabel(meldRank)}.`)
  return ok()
}

function discard(state, cardId) {
  if (state.phase !== "meld") return fail("Discard after you draw.")
  const player = current(state)
  const index = player.hand.findIndex((card) => card.id === cardId)
  if (index < 0) return fail("That card is not in your hand.")
  const card = player.hand[index]
  if (isRedThree(card)) return fail("Red threes are played to the table, not discarded.")
  const going = player.hand.length === 1
  if (going && !hasFoot(player) && !meetsGoOut(state, teamOf(state).melds)) return fail(goOutMessage(state))
  player.hand.splice(index, 1)
  state.discard.push(card)
  if (going && pickupFoot(state, player)) {
    say(state, `${actor(player)} ${act(player, "discard", "discards")} ${cardName(card)} and ${act(player, "pick up the foot", "picks up the foot")}.`)
    advanceTurn(state)
    return ok()
  }
  if (going) {
    say(state, `${actor(player)} ${act(player, "discard", "discards")} ${cardName(card)} and ${act(player, "go", "goes")} out.`)
    finishOut(state)
    return ok()
  }
  say(state, `${actor(player)} ${act(player, "discard", "discards")} ${cardName(card)}.`)
  advanceTurn(state)
  return ok()
}

function goOut(state, cardId = null) {
  if (state.phase !== "meld") return fail("You cannot go out yet.")
  const player = current(state)
  const team = teamOf(state)
  if (hasFoot(player)) return fail("Play your foot before you go out.")
  if (!meetsGoOut(state, team.melds)) return fail(goOutMessage(state))
  if (!player.hand.length) {
    say(state, `${actor(player)} ${act(player, "go", "goes")} out.`)
    finishOut(state)
    return ok()
  }
  let discardCard = null
  if (cardId != null) {
    discardCard = player.hand.find((card) => card.id === cardId)
    if (!discardCard) return fail("That card is not in your hand.")
    if (isRedThree(discardCard)) return fail("Red threes are not discarded.")
  }
  const rest = player.hand.filter((card) => !discardCard || card.id !== discardCard.id)
  if (!rest.length) return discard(state, cardId)
  const parsed = describeMeld(rest, true)
  if (!parsed.ok || !parsed.black) return fail("Meld the rest of your hand first. Black threes can go down as you go out.")
  if (team.melds.some((meld) => meld.rank === 3)) return fail("Your side already melded black threes.")
  team.melds.push({ rank: 3, cards: rest })
  player.hand = []
  player.hasMelded = true
  if (discardCard) state.discard.push(discardCard)
  say(state, `${actor(player)} ${act(player, "meld", "melds")} black threes and ${act(player, "go", "goes")} out.`)
  finishOut(state)
  return ok()
}

function undo(state) {
  if (state.phase !== "meld" || !state.turnState?.snapshot) return fail("Nothing to take back.")
  const snap = state.turnState.snapshot
  const restored = structuredClone(snap)
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, restored)
  state.turnState.snapshot = snap
  say(state, "Took back the melds from this turn.")
  return ok()
}

function decline(state) {
  if (state.phase !== "draw" || !state.mayDecline) return fail("You can still play this hand.")
  say(state, `${actor(current(state))} ${act(current(state), "decline", "declines")} the discard. The hand ends.`)
  endHand(state, "stock")
  return ok()
}

function nextHand(state) {
  if (state.phase === "matchEnd") return fail("The match is over.")
  if (state.phase !== "handEnd") return fail("This hand is still being played.")
  return dealHand(state)
}

export function apply(state, action) {
  switch (action?.type) {
    case "deal":
      return dealHand(state)
    case "draw":
      return draw(state)
    case "take":
      return take(state, action.groups || [])
    case "open":
      return open(state, action.groups || [], action.discardId ?? null)
    case "meld":
      return meld(state, action.cardIds || [])
    case "layoff":
      return layoff(state, action.cardIds || [], action.rank)
    case "discard":
      return discard(state, action.cardId)
    case "goOut":
      return goOut(state, action.cardId ?? null)
    case "undo":
      return undo(state)
    case "decline":
      return decline(state)
    case "next":
      return nextHand(state)
    default:
      return fail("Unknown action.")
  }
}

export function rankName(rank) {
  return RANK_NAME[rank] || ""
}
