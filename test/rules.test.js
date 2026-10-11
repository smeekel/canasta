import assert from "node:assert/strict"
import test from "node:test"
import {
  HANDS_PER_MATCH,
  apply,
  canastaBreakdown,
  canastasNeeded,
  cardPoints,
  createMatch,
  describeMeld,
  discardInfo,
  evaluateScores,
  isBlackThree,
  isRedThree,
  isWild,
  openingRequirement,
  placementAllowed,
  sideName,
} from "../js/engine.js"
import { planTurn } from "../js/ai.js"

function allCards(state) {
  return [
    ...state.stock,
    ...state.discard,
    ...state.players.flatMap((player) => [...player.hand, ...(player.foot || [])]),
    ...state.teams.flatMap((team) => [...team.redThrees, ...team.melds.flatMap((meld) => meld.cards)]),
  ]
}

function extract(state, pred, count = Infinity) {
  const found = []
  const piles = [state.stock, state.discard, ...state.players.flatMap((player) => [player.hand, player.foot].filter(Boolean))]
  for (const team of state.teams) {
    piles.push(team.redThrees)
    for (const meld of team.melds) piles.push(meld.cards)
  }
  for (const pile of piles) {
    for (let i = pile.length - 1; i >= 0 && found.length < count; i--) {
      if (pred(pile[i])) found.push(pile.splice(i, 1)[0])
    }
  }
  return found
}

function scoop(state) {
  const cards = allCards(state)
  state.stock = []
  state.discard = []
  for (const player of state.players) {
    player.hand = []
    if (player.foot) player.foot = []
  }
  for (const team of state.teams) {
    team.redThrees = []
    team.melds = []
    team.opened = false
  }
  return cards
}

function fresh(opponents = 3, seed = 1) {
  const state = createMatch({ opponents, seed })
  const dealt = apply(state, { type: "deal" })
  assert.equal(dealt.ok, true)
  return state
}

function setTurn(state, seat = 0) {
  state.turn = seat
  state.phase = "draw"
  state.turnState = null
  state.mustTake = false
  state.mayDecline = false
  state.out = null
}

function act(state, action) {
  const result = apply(state, action)
  assert.equal(result.ok, true, result.error || JSON.stringify(action))
  return result
}

test("deck is two packs plus four jokers", () => {
  const state = fresh(3, 2)
  const cards = allCards(state)
  assert.equal(cards.length, 108)
  assert.equal(new Set(cards.map((card) => card.id)).size, 108)
  assert.equal(cards.filter((card) => card.rank === 0).length, 4)
  assert.equal(cards.filter(isRedThree).length, 4)
  for (let rank = 1; rank <= 13; rank++) assert.equal(cards.filter((card) => card.rank === rank).length, 8)
})

test("deal sizes, red threes, and a legal upcard", () => {
  for (const [opponents, size] of [
    [1, 15],
    [2, 13],
    [3, 11],
  ]) {
    const state = fresh(opponents, 4)
    for (const player of state.players) {
      assert.equal(player.hand.length, size)
      assert.equal(player.hand.some(isRedThree), false)
    }
    const top = state.discard.at(-1)
    assert.equal(isWild(top) || isRedThree(top), false)
    assert.equal(allCards(state).length, 108)
  }
})

test("a saved name replaces You on the scoreboard", () => {
  const state = fresh(3, 6)
  assert.equal(sideName(state, 0), "Your side")
  assert.equal(sideName(state, 1), "Mina & Noah")
  state.players[0].name = "Ada"
  assert.equal(sideName(state, 0), "Ada & Ellis")
  const solo = fresh(1, 7)
  solo.players[0].name = "Ada"
  assert.equal(sideName(solo, 0), "Ada")
})

test("opening requirements follow the classic table", () => {
  assert.equal(openingRequirement(-100), 15)
  assert.equal(openingRequirement(0), 50)
  assert.equal(openingRequirement(1495), 50)
  assert.equal(openingRequirement(1500), 90)
  assert.equal(openingRequirement(2995), 90)
  assert.equal(openingRequirement(3000), 120)
  assert.equal(canastasNeeded({ playerCount: 2 }), 2)
  assert.equal(canastasNeeded({ playerCount: 4 }), 1)
})

test("meld shape: two naturals, at most three wilds, no lone wilds", () => {
  const n = (rank, suit = "s") => ({ id: rank * 10 + suit.charCodeAt(0), rank, suit, deck: 0 })
  assert.equal(describeMeld([n(13, "s"), n(13, "h"), n(2, "c")]).ok, true)
  assert.equal(describeMeld([n(13, "s"), n(2, "c"), n(0, "r")]).ok, false)
  assert.equal(describeMeld([n(8, "s"), n(8, "h"), n(2), n(2, "h"), n(2, "d"), n(0, "b")]).ok, false)
  assert.equal(describeMeld([n(4), n(4, "h"), n(4, "d")]).points, 15)
  assert.equal(describeMeld([n(3, "s"), n(3, "c"), n(3, "s")]).ok, false)
  assert.equal(describeMeld([n(3, "s"), n(3, "c"), n(3, "s")], true).ok, true)
  const wilds = [n(2, "s"), n(2, "h"), n(2, "d"), n(2, "c"), n(0, "r"), n(0, "b"), n(2, "s")]
  assert.equal(describeMeld(wilds).ok, false)
  assert.equal(describeMeld(wilds, false, true).wild, true)
  assert.equal(describeMeld(wilds, false, true).rank, -1)
})

test("card points", () => {
  assert.equal(cardPoints({ rank: 0 }), 50)
  assert.equal(cardPoints({ rank: 1 }), 20)
  assert.equal(cardPoints({ rank: 2 }), 20)
  assert.equal(cardPoints({ rank: 13 }), 10)
  assert.equal(cardPoints({ rank: 8 }), 10)
  assert.equal(cardPoints({ rank: 7 }), 5)
  assert.equal(cardPoints({ rank: 3 }), 5)
})

test("a frozen pile needs a natural pair and buried cards do not count toward the open", () => {
  const state = fresh(3, 8)
  setTurn(state, 0)
  const fours = extract(state, (card) => card.rank === 4, 2)
  const fives = extract(state, (card) => card.rank === 5, 2)
  const joker = extract(state, (card) => card.rank === 0, 1)
  const wild = extract(state, (card) => card.rank === 2, 1)
  const buried = extract(state, (card) => card.rank === 13, 1)[0]
  const top = extract(state, (card) => card.rank === 4, 1)[0]
  const rest = scoop(state)
  state.players[0].hand = [...fours, ...fives, ...joker]
  state.discard = [wild[0], buried, top]
  state.stock = rest
  state.teams[0].total = 0
  assert.equal(discardInfo(state).frozen, true)
  assert.equal(discardInfo(state).mode, "pair")
  const short = apply(state, { type: "take", groups: [[fours[0].id, joker[0].id]] })
  assert.equal(short.ok, false)
  const under = apply(state, { type: "take", groups: [fours.map((card) => card.id)] })
  assert.equal(under.ok, false)
  assert.equal(state.phase, "draw")
  const opened = apply(state, {
    type: "take",
    groups: [fours.map((card) => card.id), [...fives, ...joker].map((card) => card.id)],
  })
  assert.equal(opened.ok, true, opened.error)
  assert.equal(state.players[0].hand.some((card) => card.id === buried.id), true)
  assert.equal(state.teams[0].opened, true)
  assert.equal(state.discard.length, 0)
  const fourMeld = state.teams[0].melds.find((meld) => meld.rank === 4)
  assert.equal(fourMeld.cards.length, 3)
})

test("an unfrozen pile can be taken by layoff, and a black three only blocks the top", () => {
  const state = fresh(3, 9)
  setTurn(state, 0)
  const sevens = extract(state, (card) => card.rank === 7, 4)
  const nine = extract(state, (card) => card.rank === 9, 1)[0]
  const six = extract(state, (card) => card.rank === 6, 1)[0]
  const black = extract(state, isBlackThree, 1)[0]
  const rest = scoop(state).filter((card) => !isRedThree(card))
  state.teams[0].melds = [{ rank: 7, cards: sevens.slice(0, 3) }]
  state.teams[0].opened = true
  state.players[0].hand = [nine, six]
  state.discard = [sevens[3]]
  state.stock = rest
  assert.equal(discardInfo(state).mode, "layoff")
  act(state, { type: "take", groups: [] })
  assert.equal(state.teams[0].melds[0].cards.length, 4)
  state.discard = [black]
  assert.equal(discardInfo(state).canTake, false)
  act(state, { type: "discard", cardId: six.id })
  assert.equal(state.discard.at(-1).id, six.id)
  assert.equal(state.discard.some((card) => card.id === black.id), true)
  assert.equal(state.discard.some((card) => isWild(card) || isRedThree(card)), false)
})

test("two players cannot go out on a single canasta", () => {
  const state = fresh(1, 3)
  setTurn(state, 0)
  const fours = extract(state, (card) => card.rank === 4, 7)
  const junk = extract(state, (card) => card.rank === 9, 1)
  scoop(state)
  state.players[0].hand = [...fours, ...junk]
  state.phase = "meld"
  state.turnState = {
    drewFromStock: true,
    tookPile: false,
    laidOff: false,
    madeCanasta: false,
    hadMelded: false,
    initialRanks: [],
    snapshot: null,
  }
  const going = apply(state, { type: "open", groups: [fours.map((card) => card.id)], discardId: junk[0].id })
  assert.equal(going.ok, false)
  assert.equal(state.teams[0].opened, false)
  assert.equal(state.players[0].hand.length, 8)
})

test("three-player concealed go-out below the opening count", () => {
  const state = fresh(2, 5)
  setTurn(state, 0)
  const fours = extract(state, (card) => card.rank === 4, 7)
  state.players[0].hand = fours
  state.teams[0].total = 0
  state.phase = "meld"
  state.turnState = {
    drewFromStock: true,
    tookPile: false,
    laidOff: false,
    madeCanasta: false,
    hadMelded: false,
    initialRanks: [],
    snapshot: null,
  }
  const result = apply(state, { type: "open", groups: [fours.map((card) => card.id)] })
  assert.equal(result.ok, true, result.error)
  assert.equal(state.phase, "handEnd")
  assert.equal(state.out.concealed, true)
  const line = state.handSummary.lines.find((item) => item.team === 0)
  assert.equal(line.going, 200)
  assert.equal(line.natural, 1)
  assert.equal(line.melded, 35)
})

test("two-player draw takes two cards and needs two canastas", () => {
  const state = fresh(1, 6)
  const seat = state.turn
  const before = state.players[seat].hand.length
  const stockBefore = state.stock.length
  state.players[seat].hand = state.players[seat].hand.filter((card) => !isRedThree(card))
  const top = []
  while (top.length < 2) {
    const card = state.stock.pop()
    if (isRedThree(card)) state.teams[state.players[seat].team].redThrees.push(card)
    else top.push(card)
  }
  state.stock.push(top[0], top[1])
  act(state, { type: "draw" })
  assert.equal(state.players[seat].hand.length, before + 2)
  assert.ok(state.stock.length <= stockBefore - 2)
  assert.equal(state.phase, "meld")
})

test("scoring: mixed canasta, red threes, and a hand penalty", () => {
  const state = fresh(3, 7)
  const cards = extract(state, (card) => card.rank === 13, 5)
  const wild = extract(state, (card) => card.rank === 2, 2)
  const reds = extract(state, isRedThree, 4)
  state.teams[0].melds = [{ rank: 13, cards: [...cards, ...wild] }]
  state.teams[0].opened = true
  state.teams[0].redThrees = reds
  state.players[0].hand = []
  state.players[2].hand = [{ id: 900, rank: 1, suit: "s", deck: 0 }]
  state.out = { player: 0, concealed: false }
  const [us] = evaluateScores(state)
  assert.equal(us.mixed, 1)
  assert.equal(us.redScore, 800)
  assert.equal(us.going, 100)
  assert.equal(us.penalty, 20)
  assert.equal(us.melded, 5 * 10 + 2 * 20)
  state.teams[1].melds = []
  state.teams[1].redThrees = reds
  state.teams[0].redThrees = []
  const scores = evaluateScores(state)
  assert.equal(scores[1].redScore, -800)
})

test("undo restores the hand and a partnership shares melds", () => {
  const state = fresh(3, 11)
  setTurn(state, 0)
  const kings = extract(state, (card) => card.rank === 13, 3)
  const filler = extract(state, (card) => card.rank === 9 && !isWild(card), 6)
  state.players[0].hand = [...kings, ...filler]
  state.phase = "meld"
  state.turnState = {
    drewFromStock: true,
    tookPile: false,
    laidOff: false,
    madeCanasta: false,
    hadMelded: false,
    initialRanks: [],
    snapshot: null,
  }
  state.teams[0].total = -10
  const snap = structuredClone(state)
  snap.turnState.snapshot = null
  state.turnState.snapshot = snap
  const handIds = state.players[0].hand.map((card) => card.id)
  act(state, { type: "open", groups: [kings.map((card) => card.id)] })
  assert.equal(state.teams[0].opened, true)
  act(state, { type: "undo" })
  assert.equal(state.teams[0].opened, false)
  assert.deepEqual(
    state.players[0].hand.map((card) => card.id).sort(),
    handIds.sort()
  )
  act(state, { type: "open", groups: [kings.map((card) => card.id)] })
  state.turn = 2
  state.players[2].hand = filler.slice(0, 3)
  state.phase = "meld"
  state.turnState = {
    drewFromStock: true,
    tookPile: false,
    laidOff: false,
    madeCanasta: false,
    hadMelded: false,
    initialRanks: [13],
    snapshot: null,
  }
  const extra = extract(state, (card) => card.rank === 13, 1)
  state.players[2].hand = [...filler.slice(0, 3), ...extra]
  act(state, { type: "layoff", cardIds: extra.map((card) => card.id), rank: 13 })
  assert.equal(state.teams[0].melds.length, 1)
  assert.equal(state.teams[0].melds[0].cards.length, 4)
})

test("a match is four hands", () => {
  const state = fresh(1, 1)
  assert.equal(state.handNumber, 1)
  state.phase = "draw"
  state.mayDecline = true
  state.stock = []
  state.mustTake = false
  act(state, { type: "decline" })
  assert.equal(state.phase, "handEnd")
  act(state, { type: "next" })
  assert.equal(state.handNumber, 2)
  state.phase = "draw"
  state.mayDecline = true
  state.stock = []
  act(state, { type: "decline" })
  act(state, { type: "next" })
  state.phase = "draw"
  state.mayDecline = true
  state.stock = []
  act(state, { type: "decline" })
  act(state, { type: "next" })
  assert.equal(state.handNumber, 4)
  state.phase = "draw"
  state.mayDecline = true
  state.stock = []
  act(state, { type: "decline" })
  assert.equal(state.phase, "matchEnd")
  assert.equal(state.history.length, HANDS_PER_MATCH)
})

function houseDeal(opponents = 1, seed = 1) {
  const state = createMatch({ opponents, seed, rules: "house" })
  act(state, { type: "deal" })
  return state
}

function asMeld(state, seat = 0) {
  state.turn = seat
  state.phase = "meld"
  state.mustTake = false
  state.mayDecline = false
  state.out = null
  state.turnState = {
    drewFromStock: true,
    tookPile: false,
    laidOff: false,
    madeCanasta: false,
    hadMelded: true,
    initialRanks: state.teams[state.players[seat].team].melds.map((meld) => meld.rank),
    snapshot: null,
  }
}

test("house rules draw two cards at every table size", () => {
  for (const opponents of [1, 2, 3]) {
    const state = houseDeal(opponents, 11)
    const seat = state.turn
    const before = state.players[seat].hand.length
    act(state, { type: "draw" })
    assert.equal(state.players[seat].hand.length, before + 2)
    assert.match(state.status, /two cards/)
    assert.equal(state.phase, "meld")
  }
})

test("house rules deal a larger pack and a foot, with no partnerships", () => {
  for (const [opponents, decks] of [
    [1, 3],
    [2, 4],
    [3, 5],
  ]) {
    const state = houseDeal(opponents, 5)
    const cards = allCards(state)
    assert.equal(cards.length, decks * 54)
    assert.equal(new Set(cards.map((card) => card.id)).size, cards.length)
    assert.equal(cards.filter((card) => card.rank === 0).length, decks * 2)
    assert.equal(state.teams.length, opponents + 1)
    state.players.forEach((player, index) => {
      assert.equal(player.team, index)
      assert.equal(player.hand.length, 13)
      assert.equal(player.foot.length, 13)
      assert.equal(player.hand.some(isRedThree), false)
    })
    const top = state.discard.at(-1)
    assert.equal(isWild(top) || isRedThree(top), false)
  }
})

test("house rules take a discard only to start a new meld", () => {
  const state = houseDeal(1, 4)
  setTurn(state, 0)
  const kings = extract(state, (card) => card.rank === 13, 6)
  const queens = extract(state, (card) => card.rank === 12, 3)
  const joker = extract(state, (card) => card.rank === 0, 1)[0]
  const rest = scoop(state).filter((card) => !isRedThree(card) && !isWild(card))
  state.teams[0].opened = true
  state.teams[0].melds = [{ rank: 13, cards: kings.slice(0, 3) }]
  state.players[0].hand = [kings[3], kings[4], queens[0], queens[1], joker, ...rest.slice(0, 4)]
  state.players[0].foot = []
  state.discard = [kings[5]]
  state.stock = rest.slice(4)

  const blocked = discardInfo(state)
  assert.equal(blocked.canTake, false)
  assert.equal(blocked.mustTake, false)
  assert.match(blocked.reason, /new meld/)
  const taken = apply(state, { type: "take", groups: [] })
  assert.equal(taken.ok, false)
  const paired = apply(state, { type: "take", groups: [[kings[3].id, kings[4].id]] })
  assert.equal(paired.ok, false)
  assert.equal(state.teams[0].melds[0].cards.length, 3)
  assert.equal(state.discard.at(-1).id, kings[5].id)

  state.stock = []
  assert.equal(discardInfo(state).canTake, false)
  assert.equal(discardInfo(state).mustTake, false)

  state.stock = rest.slice(4)
  state.discard = [queens[2]]
  const fresh = discardInfo(state)
  assert.equal(fresh.canTake, true)
  assert.equal(fresh.mode, "pair")
  act(state, { type: "take", groups: [[queens[0].id, queens[1].id]] })
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 12).cards.length, 3)
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 13).cards.length, 3)
})

test("a house hand ends when the stock is used up", () => {
  const state = houseDeal(2, 1)
  state.phase = "draw"
  state.mayDecline = true
  state.stock = []
  act(state, { type: "decline" })
  assert.equal(state.phase, "handEnd")
  assert.equal(state.history.length, 1)
  assert.equal(state.endReason, "stock")
})

test("house rules plays four hands and the opening count rises", () => {
  const counts = [50, 90, 120, 150]
  for (let hand = 1; hand <= 4; hand++) {
    const marker = { rules: "house", handNumber: hand }
    assert.equal(openingRequirement(5000, marker), counts[hand - 1])
    assert.equal(openingRequirement(-400, marker), counts[hand - 1])
  }

  const low = houseDeal(1, 9)
  const aces = extract(low, (card) => card.rank === 1, 3)
  const filler = extract(low, (card) => card.rank === 9, 2)
  low.players[0].hand = [...aces, ...filler]
  low.players[0].foot = []
  low.teams[0].opened = false
  low.teams[0].melds = []
  asMeld(low)
  low.handNumber = 2
  const short = apply(low, { type: "open", groups: [aces.map((card) => card.id)] })
  assert.equal(short.ok, false)
  assert.match(short.error, /90/)
  assert.equal(low.teams[0].opened, false)

  const state = houseDeal(1, 2)
  assert.match(state.status, /Hand 1 of 4/)
  assert.match(state.status, /Opening count: 50/)
  for (let hand = 1; hand <= 4; hand++) {
    assert.equal(state.handNumber, hand)
    assert.equal(openingRequirement(state.teams[0].total, state), counts[hand - 1])
    state.phase = "draw"
    state.mayDecline = true
    state.stock = []
    state.turn = 0
    act(state, { type: "decline" })
    if (hand < 4) {
      assert.equal(state.phase, "handEnd")
      act(state, { type: "next" })
      assert.match(state.status, new RegExp(`Hand ${hand + 1} of 4`))
      assert.match(state.status, new RegExp(`Opening count: ${counts[hand]}`))
    }
  }
  assert.equal(state.phase, "matchEnd")
  assert.equal(state.history.length, 4)
  const again = apply(state, { type: "next" })
  assert.equal(again.ok, false)
})

test("emptying the hand picks up the foot instead of going out", () => {
  const state = houseDeal(1, 4)
  const eights = extract(state, (card) => card.rank === 8, 3)
  const nines = extract(state, (card) => card.rank === 9, 5)
  const fours = extract(state, (card) => card.rank === 4, 3)
  const rest = scoop(state)
  state.stock = rest
  state.players[0].hand = eights
  state.players[0].foot = nines
  state.teams[0].opened = true
  state.teams[0].melds = [{ rank: 4, cards: fours }]
  asMeld(state)
  act(state, { type: "meld", cardIds: eights.map((card) => card.id) })
  assert.equal(state.phase, "meld")
  assert.equal(state.turn, 0)
  assert.equal(state.players[0].foot.length, 0)
  assert.deepEqual(
    state.players[0].hand.map((card) => card.id).sort(),
    nines.map((card) => card.id).sort()
  )

  state.players[0].hand = [nines[0]]
  state.players[0].foot = nines.slice(1)
  const result = apply(state, { type: "discard", cardId: nines[0].id })
  assert.equal(result.ok, true, result.error)
  assert.equal(state.phase, "draw")
  assert.equal(state.turn, 1)
  assert.equal(state.players[0].foot.length, 0)
  assert.equal(state.phase === "matchEnd", false)
})

test("going out takes one pure, one mixed, and one wild canasta, and more are allowed", () => {
  const state = houseDeal(1, 6)
  const fours = extract(state, (card) => card.rank === 4, 7)
  const sevens = extract(state, (card) => card.rank === 7, 7)
  const kings = extract(state, (card) => card.rank === 13, 6)
  const joker = extract(state, (card) => card.rank === 0, 1)
  const twos = extract(state, (card) => card.rank === 2, 14)
  const eight = extract(state, (card) => card.rank === 8, 1)
  scoop(state)
  const player = state.players[0]
  player.foot = []
  player.hand = eight
  state.teams[0].opened = true
  state.teams[0].melds = [
    { rank: 4, cards: fours },
    { rank: 13, cards: [...kings, ...joker] },
  ]
  asMeld(state)
  const early = apply(state, { type: "discard", cardId: eight[0].id })
  assert.equal(early.ok, false)
  assert.match(early.error, /wild canasta/)
  assert.equal(player.hand.length, 1)

  state.teams[0].melds.push({ rank: 7, cards: sevens }, { rank: -1, cards: twos.slice(0, 7) })
  player.foot = twos.slice(7, 10)
  const held = apply(state, { type: "goOut", cardId: eight[0].id })
  assert.equal(held.ok, false)
  assert.match(held.error, /foot/)
  assert.equal(state.phase, "meld")

  player.foot = []
  act(state, { type: "discard", cardId: eight[0].id })
  assert.equal(state.phase, "handEnd")
  assert.equal(state.endReason, "out")
  const line = state.handSummary.lines.find((item) => item.team === 0)
  assert.equal(line.natural, 2)
  assert.equal(line.mixed, 1)
  assert.equal(line.wild, 1)
  assert.equal(line.going, 100)
  assert.ok(line.delta >= 500 * 2 + 300 + 1500)
})

test("a completed canasta refuses an eighth card", () => {
  const n = (rank, suit, deck) => ({ id: rank * 100 + suit.charCodeAt(0) + deck, rank, suit, deck })
  const suits = ["s", "h", "d", "c"]
  const eightQueens = Array.from({ length: 8 }, (_, index) => n(12, suits[index % 4], index))
  assert.equal(describeMeld(eightQueens).ok, false)
  assert.match(describeMeld(eightQueens).error, /7 cards/)
  assert.equal(describeMeld(eightQueens.slice(0, 7)).ok, true)
  const eightWilds = Array.from({ length: 8 }, (_, index) => n(index < 6 ? 2 : 0, suits[index % 4], index))
  assert.equal(describeMeld(eightWilds, false, true).ok, false)
  assert.equal(describeMeld(eightWilds.slice(0, 7), false, true).wild, true)

  const state = houseDeal(1, 8)
  const queens = extract(state, (card) => card.rank === 12, 8)
  const kings = extract(state, (card) => card.rank === 13, 8)
  const eights = extract(state, (card) => card.rank === 8, 8)
  const joker = extract(state, (card) => card.rank === 0, 1)[0]
  scoop(state)
  const player = state.players[0]
  player.hand = [queens[7], kings[6], kings[7], joker, ...eights]
  player.foot = []
  state.teams[0].opened = true
  state.teams[0].melds = [
    { rank: 12, cards: queens.slice(0, 7) },
    { rank: 13, cards: kings.slice(0, 6) },
  ]
  asMeld(state)

  const extra = apply(state, { type: "layoff", cardIds: [queens[7].id], rank: 12 })
  assert.equal(extra.ok, false)
  assert.match(extra.error, /complete/)
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 12).cards.length, 7)
  assert.equal(player.hand.some((card) => card.id === queens[7].id), true)

  const overflow = apply(state, { type: "layoff", cardIds: [kings[6].id, kings[7].id], rank: 13 })
  assert.equal(overflow.ok, false)
  assert.match(overflow.error, /7 cards/)
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 13).cards.length, 6)

  act(state, { type: "layoff", cardIds: [kings[6].id], rank: 13 })
  const kingMeld = state.teams[0].melds.find((meld) => meld.rank === 13)
  assert.equal(kingMeld.cards.length, 7)
  assert.equal(state.turnState.madeCanasta, true)

  const onCanasta = apply(state, { type: "layoff", cardIds: [joker.id], rank: 13 })
  assert.equal(onCanasta.ok, false)
  assert.match(onCanasta.error, /complete/)
  assert.equal(kingMeld.cards.length, 7)

  const freshMeld = apply(state, { type: "meld", cardIds: eights.map((card) => card.id) })
  assert.equal(freshMeld.ok, false)
  assert.match(freshMeld.error, /7 cards/)
  assert.equal(state.teams[0].melds.some((meld) => meld.rank === 8), false)

  player.hand = player.hand.filter((card) => card.id !== queens[7].id)
  state.phase = "draw"
  state.discard = [queens[7]]
  const info = discardInfo(state)
  assert.equal(info.canTake, false)
  const taken = apply(state, { type: "take", groups: [] })
  assert.equal(taken.ok, false)
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 12).cards.length, 7)
})

test("a finished canasta can be followed by another of the same rank", () => {
  const state = houseDeal(1, 5)
  const sevens = extract(state, (card) => card.rank === 7, 12)
  const filler = extract(state, (card) => card.rank === 9, 4)
  scoop(state)
  const player = state.players[0]
  player.foot = []
  state.teams[0].opened = true
  state.teams[0].melds = [{ rank: 7, cards: sevens.slice(0, 4) }]
  player.hand = [...sevens.slice(4, 7), ...filler]
  asMeld(state)

  const early = apply(state, { type: "meld", cardIds: sevens.slice(4, 7).map((card) => card.id) })
  assert.equal(early.ok, false)
  assert.match(early.error, /Add to the meld/)
  assert.equal(state.teams[0].melds.length, 1)
  assert.equal(state.teams[0].melds[0].cards.length, 4)

  state.teams[0].melds = [{ rank: 7, cards: sevens.slice(0, 7) }]
  player.hand = [...sevens.slice(7, 10), ...filler]
  act(state, { type: "meld", cardIds: sevens.slice(7, 10).map((card) => card.id) })
  let piles = state.teams[0].melds.filter((meld) => meld.rank === 7)
  assert.equal(piles.length, 2)
  assert.equal(piles[0].cards.length, 7)
  assert.equal(piles[1].cards.length, 3)

  player.hand = [sevens[10], ...filler]
  act(state, { type: "layoff", cardIds: [sevens[10].id], rank: 7 })
  assert.equal(piles[0].cards.length, 7)
  assert.equal(piles[1].cards.length, 4)

  state.phase = "draw"
  state.turn = 0
  state.discard = [sevens[11]]
  state.stock = []
  assert.equal(discardInfo(state).canTake, false)

  const again = houseDeal(1, 6)
  const more = extract(again, (card) => card.rank === 7, 10)
  const extra = extract(again, (card) => card.rank === 4, 3)
  scoop(again)
  again.players[0].foot = []
  again.teams[0].opened = true
  again.teams[0].melds = [{ rank: 7, cards: more.slice(0, 7) }]
  again.players[0].hand = [...more.slice(7, 9), ...extra]
  again.discard = [more[9]]
  again.stock = []
  setTurn(again, 0)
  const allowed = discardInfo(again)
  assert.equal(allowed.canTake, true)
  assert.equal(allowed.mode, "pair")
  act(again, { type: "take", groups: [[more[7].id, more[8].id]] })
  const next = again.teams[0].melds.filter((meld) => meld.rank === 7)
  assert.equal(next.length, 2)
  assert.equal(next[0].cards.length, 7)
  assert.equal(next[1].cards.length, 3)
})

test("a finished wild canasta can be followed by another", () => {
  const state = houseDeal(1, 7)
  const twos = extract(state, (card) => card.rank === 2, 12)
  const jokers = extract(state, (card) => card.rank === 0, 2)
  const filler = extract(state, (card) => card.rank === 8, 2)
  const fours = extract(state, (card) => card.rank === 4, 3)
  scoop(state)
  state.players[0].hand = [...twos, ...jokers, ...filler]
  state.players[0].foot = []
  state.teams[0].opened = true
  state.teams[0].melds = [{ rank: 4, cards: fours }]
  asMeld(state)
  act(state, { type: "meld", cardIds: twos.slice(0, 7).map((card) => card.id) })
  act(state, { type: "meld", cardIds: [...twos.slice(7), ...jokers].map((card) => card.id) })
  assert.equal(canastaBreakdown(state.teams[0].melds).wild, 2)
  assert.equal(state.phase, "meld")
})

test("AI finishes a house-rules game", () => {
  for (const opponents of [1, 2, 3]) {
    const state = createMatch({ opponents, seed: opponents + 3, rules: "house" })
    act(state, { type: "deal" })
    let guard = 0
    while (state.phase !== "matchEnd" && guard++ < 12000) {
      if (state.phase === "handEnd") {
        act(state, { type: "next" })
        continue
      }
      const plan = planTurn(state)
      assert.equal(plan.ok, true, plan.error)
      for (const action of plan.actions) act(state, action)
    }
    assert.equal(state.phase, "matchEnd")
    assert.ok(state.endReason === "stock" || state.endReason === "out")
    assert.equal(state.history.length, 4)
  }
})

test("a first meld that takes the discard still has to meet the opening count", () => {
  const short = houseDeal(1, 21)
  const sevens = extract(short, (card) => card.rank === 7, 3)
  const junk = [8, 9, 10, 11].map((rank) => extract(short, (card) => card.rank === rank, 1)[0])
  const buried = extract(short, (card) => card.rank === 0, 1)[0]
  scoop(short)
  short.players[0].hand = [sevens[0], sevens[1], ...junk]
  short.players[0].foot = []
  short.discard = [buried, sevens[2]]
  short.stock = []
  short.teams[0].opened = false
  short.handNumber = 1
  setTurn(short, 0)
  const blocked = discardInfo(short)
  assert.equal(blocked.canTake, false)
  assert.match(blocked.reason, /50/)
  const refused = apply(short, { type: "take", groups: [[sevens[0].id, sevens[1].id]] })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /50/)
  assert.equal(short.teams[0].opened, false)
  assert.equal(short.discard.at(-1).id, sevens[2].id)
  assert.equal(short.players[0].hand.some((card) => card.id === buried.id), false)

  const enough = houseDeal(1, 22)
  const aces = extract(enough, (card) => card.rank === 1, 3)
  const lows = extract(enough, (card) => card.rank === 4, 3)
  const keep = extract(enough, (card) => card.rank === 9, 2)
  scoop(enough)
  enough.players[0].hand = [...aces.slice(0, 2), ...lows.slice(0, 2), ...keep]
  enough.players[0].foot = []
  enough.discard = [aces[2]]
  enough.teams[0].opened = false
  enough.handNumber = 1
  setTurn(enough, 0)
  assert.equal(discardInfo(enough).canTake, true)
  const onlyLows = apply(enough, { type: "take", groups: [lows.slice(0, 2).map((card) => card.id)] })
  assert.equal(onlyLows.ok, false)
  assert.equal(enough.teams[0].opened, false)
  act(enough, { type: "take", groups: [aces.slice(0, 2).map((card) => card.id)] })
  assert.equal(enough.teams[0].opened, true)
  assert.equal(enough.teams[0].melds[0].cards.length, 3)
  assert.equal(enough.teams[0].melds[0].cards.reduce((sum, card) => sum + cardPoints(card), 0), 60)

  const later = houseDeal(1, 23)
  const laterAces = extract(later, (card) => card.rank === 1, 3)
  const kings = extract(later, (card) => card.rank === 13, 3)
  const hold = extract(later, (card) => card.rank === 9, 2)
  scoop(later)
  later.players[0].hand = [...laterAces.slice(0, 2), ...kings, ...hold]
  later.players[0].foot = []
  later.discard = [laterAces[2]]
  later.teams[0].opened = false
  later.handNumber = 2
  setTurn(later, 0)
  assert.equal(openingRequirement(0, later), 90)
  assert.equal(discardInfo(later).canTake, true)
  const acesOnly = apply(later, { type: "take", groups: [laterAces.slice(0, 2).map((card) => card.id)] })
  assert.equal(acesOnly.ok, false)
  assert.match(acesOnly.error, /90/)
  assert.equal(later.teams[0].opened, false)
  act(later, {
    type: "take",
    groups: [laterAces.slice(0, 2).map((card) => card.id), kings.map((card) => card.id)],
  })
  assert.equal(later.teams[0].opened, true)
  assert.equal(later.teams[0].melds.length, 2)

  const exact = houseDeal(1, 24)
  const exactKings = extract(exact, (card) => card.rank === 13, 5)
  const spare = [8, 9].map((rank) => extract(exact, (card) => card.rank === rank, 1)[0])
  scoop(exact)
  exact.players[0].hand = [...exactKings.slice(0, 4), ...spare]
  exact.players[0].foot = []
  exact.discard = [exactKings[4]]
  exact.teams[0].opened = false
  setTurn(exact, 0)
  assert.equal(discardInfo(exact).canTake, true)
  act(exact, { type: "take", groups: [exactKings.slice(0, 4).map((card) => card.id)] })
  assert.equal(exact.teams[0].melds[0].cards.reduce((sum, card) => sum + cardPoints(card), 0), 50)

  const lowScore = fresh(1, 31)
  const fours = extract(lowScore, (card) => card.rank === 4, 3)
  const fillers = [8, 9].map((rank) => extract(lowScore, (card) => card.rank === rank, 1)[0])
  scoop(lowScore)
  lowScore.players[0].hand = [fours[0], fours[1], ...fillers]
  lowScore.discard = [fours[2]]
  lowScore.teams[0].total = -100
  lowScore.teams[0].opened = false
  setTurn(lowScore, 0)
  assert.equal(openingRequirement(lowScore.teams[0].total, lowScore), 15)
  assert.equal(discardInfo(lowScore).canTake, true)
  act(lowScore, { type: "take", groups: [[fours[0].id, fours[1].id]] })
  assert.equal(lowScore.teams[0].opened, true)
})

test("three wild cards can start a meld while a short natural meld could take them", () => {
  const state = houseDeal(1, 12)
  const twos = extract(state, (card) => card.rank === 2, 3)
  const sixes = extract(state, (card) => card.rank === 6, 4)
  const aces = extract(state, (card) => card.rank === 1, 5)
  const jacks = extract(state, (card) => card.rank === 11, 5)
  const rest = extract(state, (card) => card.rank === 12 || card.rank === 10 || card.rank === 8 || card.rank === 4, 5)
  const foot = extract(state, (card) => card.rank >= 4, 13)
  const blocker = extract(state, (card) => card.rank === 2 || card.rank === 0, 3)
  scoop(state)
  const player = state.players[0]
  player.hand = [...twos, ...rest]
  player.foot = foot
  state.teams[0].opened = true
  state.teams[0].melds = [
    { rank: 1, cards: aces },
    { rank: 11, cards: jacks },
    { rank: 6, cards: sixes },
    { rank: -1, cards: blocker },
  ]
  asMeld(state)
  const refused = apply(state, { type: "meld", cardIds: twos.map((card) => card.id) })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /wild meld/)
  state.teams[0].melds = state.teams[0].melds.filter((meld) => meld.rank >= 0)
  const laid = structuredClone(state)
  act(laid, { type: "layoff", cardIds: twos.map((card) => card.id), rank: 6 })
  assert.equal(laid.teams[0].melds.find((meld) => meld.rank === 6).cards.length, 7)
  assert.equal(laid.teams[0].melds.some((meld) => meld.rank < 0), false)
  act(state, { type: "meld", cardIds: twos.map((card) => card.id) })
  const wild = state.teams[0].melds.find((meld) => meld.rank < 0)
  assert.equal(wild.cards.length, 3)
  assert.deepEqual(
    wild.cards.map((card) => card.id).sort(),
    twos.map((card) => card.id).sort()
  )
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 6).cards.length, 4)
  assert.equal(player.hand.length, 5)
  assert.equal(player.foot.length, 13)
  assert.equal(state.phase, "meld")
})

test("a wild card can join an open wild meld while one card and the foot remain", () => {
  const state = houseDeal(1, 9)
  const wilds = extract(state, (card) => card.rank === 2 || card.rank === 0, 6)
  const kings = extract(state, (card) => card.rank === 13, 5)
  const queen = extract(state, (card) => card.rank === 12, 1)
  const foot = extract(state, (card) => card.rank >= 4 && card.rank <= 11, 13)
  const pure = extract(state, (card) => card.rank === 4, 7)
  const mixedNatural = extract(state, (card) => card.rank === 7, 6)
  const mixedWild = extract(state, (card) => card.rank === 2 || card.rank === 0, 1)
  const wildCanasta = extract(state, (card) => card.rank === 2 || card.rank === 0, 7)
  scoop(state)
  const player = state.players[0]
  const two = wilds.pop()
  player.hand = [two, ...queen]
  player.foot = foot
  state.teams[0].opened = true
  state.teams[0].melds = [
    { rank: -1, cards: wilds },
    { rank: 13, cards: kings },
  ]
  asMeld(state)
  const grown = state.teams[0].melds.map((meld) =>
    meld.rank < 0 ? { rank: meld.rank, cards: [...meld.cards, two] } : meld
  )
  assert.equal(placementAllowed(state, 0, 1, grown), true)
  assert.equal(placementAllowed(state, 0, 0, grown), true)
  player.foot = []
  assert.equal(placementAllowed(state, 0, 1, grown), false)
  assert.equal(placementAllowed(state, 0, 0, grown), false)
  const ready = [
    { rank: 4, cards: pure },
    { rank: 7, cards: [...mixedNatural, ...mixedWild] },
    { rank: -2, cards: wildCanasta },
  ]
  assert.equal(placementAllowed(state, 0, 0, ready), true)
  player.foot = foot
  act(state, { type: "layoff", cardIds: [two.id], rank: -1 })
  const wildMeld = state.teams[0].melds.find((meld) => meld.rank < 0)
  assert.equal(wildMeld.cards.length, 6)
  assert.ok(wildMeld.cards.some((card) => card.id === two.id))
  assert.equal(state.teams[0].melds.find((meld) => meld.rank === 13).cards.length, 5)
  assert.equal(player.hand.length, 1)
  assert.equal(player.foot.length, 13)
  assert.equal(state.phase, "meld")
})

test("AI finishes matches for every table size", () => {
  for (const opponents of [1, 2, 3]) {
    for (const seed of [1, 2, 3]) {
      const state = createMatch({ opponents, seed })
      act(state, { type: "deal" })
      let guard = 0
      while (state.phase !== "matchEnd" && guard++ < 4000) {
        if (state.phase === "handEnd") {
          act(state, { type: "next" })
          continue
        }
        const plan = planTurn(state)
        assert.equal(plan.ok, true, plan.error)
        assert.ok(plan.actions.length > 0)
        for (const action of plan.actions) act(state, action)
      }
      assert.equal(state.phase, "matchEnd", `seed ${seed} opponents ${opponents} stuck in ${state.phase}`)
      assert.equal(state.history.length, 4)
    }
  }
})
