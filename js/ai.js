import {
  apply,
  canastasNeeded,
  canastaBreakdown,
  cardPoints,
  countCanastas,
  describeMeld,
  discardInfo,
  isBlackThree,
  isNatural,
  isRedThree,
  isWild,
  meetsGoOut,
  openingRequirement,
  WILD_RANK,
} from "./engine.js"

function seat(state) {
  return state.players[state.turn]
}

function side(state) {
  return state.teams[seat(state).team]
}

function partner(state) {
  if (state.rules === "house" || state.playerCount !== 4) return null
  const me = seat(state)
  return state.players.find((player) => player !== me && player.team === me.team) || null
}

function footWaiting(state) {
  return state.rules === "house" && !!seat(state).foot?.length
}

function naturalsOf(hand) {
  const buckets = new Map()
  for (const card of hand) {
    if (!isNatural(card)) continue
    if (!buckets.has(card.rank)) buckets.set(card.rank, [])
    buckets.get(card.rank).push(card)
  }
  return buckets
}

function openingPlan(state, info = null) {
  const hand = seat(state).hand
  const extra = info?.top && info.canTake ? info.top : null
  const frozen = info ? info.frozen : !side(state).opened
  const target = openingRequirement(side(state).total)
  const fromStock = !!state.turnState?.drewFromStock && !extra
  const needed = canastasNeeded(state)
  const wilds = hand.filter(isWild).slice().sort((a, b) => cardPoints(a) - cardPoints(b))
  const buckets = naturalsOf(hand)
  const ranks = [...buckets.keys()]
  let best = null
  let nodes = 0

  function consider(chosen) {
    const final = chosen.map((group) => ({ rank: group.rank, cards: group.cards.slice() }))
    if (extra) {
      const group = final.find((item) => item.rank === extra.rank)
      if (!group) return
      const naturalCount = group.cards.filter((card) => card.rank === extra.rank).length
      if (naturalCount < (frozen ? 2 : 1)) return
      if (!frozen && naturalCount < 2 && !group.cards.some(isWild)) return
      group.cards = [...group.cards, extra]
    }
    let points = 0
    let canastas = 0
    const used = new Set()
    for (const group of final) {
      const parsed = describeMeld(group.cards, false, state.rules === "house")
      if (!parsed.ok) return
      points += parsed.points
      if (group.cards.length >= 7) canastas += 1
      for (const card of group.cards) {
        if (extra && card === extra) continue
        if (used.has(card.id)) return
        used.add(card.id)
      }
    }
    const left = hand.filter((card) => !used.has(card.id))
    let going = left.length <= 1
    if (state.rules === "house") {
      let pure = 0
      let mixed = 0
      let wild = 0
      for (const group of final) {
        if (group.cards.length < 7) continue
        if (group.cards.every(isWild)) wild += 1
        else if (group.cards.some(isWild)) mixed += 1
        else pure += 1
      }
      const ready = pure >= 1 && mixed >= 1 && wild >= 1
      going = !footWaiting(state) && left.length <= 1
      const waiver = fromStock && going && ready
      if (points < target && !waiver) return
      if (going && !ready) return
      if (!footWaiting(state) && left.length < 2 && !ready) return
    } else {
      const waiver = fromStock && going && canastas >= needed
      if (points < target && !waiver) return
      if (going && canastas < needed) return
      if (!going && left.length < 2 && canastas < needed) return
    }
    const score = (going ? 4000 : 0) + canastas * 500 + (18 - used.size) * 8 + points
    if (!best || score > best.score) {
      best = {
        score,
        groups: chosen.map((group) => group.cards.map((card) => card.id)),
        discardId: left.length === 1 ? left[0].id : null,
      }
    }
  }

  function walk(index, wildIndex, chosen) {
    if (++nodes > 25000) return
    if (index === ranks.length) {
      if (chosen.length) consider(chosen)
      return
    }
    const rank = ranks[index]
    const cards = buckets.get(rank)
    const wildsLeft = wilds.length - wildIndex
    walk(index + 1, wildIndex, chosen)
    const options = []
    const limit = Math.min(cards.length, 7)
    if (limit >= 3) options.push([limit, 0])
    if (cards.length >= 5) options.push([Math.min(cards.length - 2, 7), 0])
    if (cards.length >= 2 && wildsLeft >= 1) options.push([Math.min(cards.length >= 3 ? cards.length : 2, 6), 1])
    if (cards.length >= 4 && wildsLeft >= 1) options.push([2, 1])
    const seen = new Set()
    for (const [take, wildCount] of options) {
      const key = `${take}:${wildCount}`
      if (seen.has(key) || take > cards.length) continue
      seen.add(key)
      const picked = cards.slice(0, take).concat(wilds.slice(wildIndex, wildIndex + wildCount))
      chosen.push({ rank, cards: picked })
      walk(index + 1, wildIndex + wildCount, chosen)
      chosen.pop()
    }
  }

  walk(0, 0, [])
  return best
}

function worthLayoff(state, info) {
  const meld = side(state).melds.find((item) => item.rank === info.top.rank)
  if (!meld) return false
  if (meld.cards.length >= 6) return true
  return state.discard.length >= 3
}

function pairGroup(state, info) {
  const hand = seat(state).hand
  const naturals = hand.filter((card) => card.rank === info.top.rank)
  if (naturals.length >= 2) return [[naturals[0].id, naturals[1].id]]
  if (info.frozen) return null
  const wild = hand.find((card) => card.rank === 2) || hand.find(isWild)
  if (wild && naturals.length >= 1) return [[naturals[0].id, wild.id]]
  return null
}

function takeAction(state) {
  const info = discardInfo(state)
  if (!info.canTake) return null
  if (info.mode === "layoff") {
    if (!state.mustTake && !worthLayoff(state, info)) return null
    return { type: "take", groups: [] }
  }
  if (!side(state).opened) {
    const plan = openingPlan(state, info)
    if (!plan) return null
    return { type: "take", groups: plan.groups }
  }
  const pile = state.discard.length
  const naturals = seat(state).hand.filter((card) => card.rank === info.top.rank).length
  const attractive = pile >= 5 || (naturals >= 4 && pile >= 2) || (naturals >= 2 && pile >= 3)
  if (!attractive) return null
  const groups = pairGroup(state, info)
  if (!groups) return null
  return { type: "take", groups }
}

function canPlace(state, removeCount, completes) {
  const left = seat(state).hand.length - removeCount
  if (state.rules === "house") {
    if (left < 0) return false
    if (footWaiting(state)) return true
    if (meetsGoOut(state, side(state).melds)) return true
    return left >= 2
  }
  const have = countCanastas(side(state).melds)
  const need = canastasNeeded(state)
  const canastas = have + (completes ? 1 : 0)
  if (left === 0) return canastas >= need
  if (canastas >= need) return true
  return left >= 2
}

function houseReady(state, melds) {
  return meetsGoOut(state, melds)
}

function houseAction(state) {
  if (state.rules !== "house" || !side(state).opened) return null
  const hand = seat(state).hand
  const melds = side(state).melds
  const kinds = canastaBreakdown(melds)
  const wilds = hand.filter(isWild)
  const place = (remove, after) => {
    const left = hand.length - remove
    if (left < 0) return false
    if (footWaiting(state)) return true
    if (houseReady(state, after)) return true
    return left >= 2
  }

  const incomplete = melds.find((meld) => meld.rank < 0 && meld.cards.length < 7)
  if (incomplete && wilds.length) {
    const give = wilds.slice(0, Math.min(wilds.length, 7 - incomplete.cards.length))
    const after = melds.map((meld) => (meld === incomplete ? { rank: meld.rank, cards: meld.cards.concat(give) } : meld))
    if (place(give.length, after)) return { type: "layoff", cardIds: give.map((card) => card.id), rank: incomplete.rank }
  }
  if (!incomplete && wilds.length >= 7) {
    const give = wilds.slice(0, 7)
    const after = melds.concat([{ rank: WILD_RANK, cards: give }])
    if (place(give.length, after)) return { type: "meld", cardIds: give.map((card) => card.id) }
  }

  for (const meld of melds) {
    if (meld.rank === 3 || meld.rank < 0 || meld.cards.some(isWild) || meld.cards.length >= 7) continue
    const give = hand.filter((card) => card.rank === meld.rank).slice(0, 7 - meld.cards.length)
    if (!give.length || (meld.cards.length + give.length < 7 && give.length < 3)) continue
    const after = melds.map((item) => (item === meld ? { rank: item.rank, cards: item.cards.concat(give) } : item))
    if (!place(give.length, after)) continue
    return { type: "layoff", cardIds: give.map((card) => card.id), rank: meld.rank }
  }

  for (const [rank, cards] of naturalsOf(hand)) {
    if (cards.length < 7 || melds.some((meld) => meld.rank === rank)) continue
    const give = cards.slice(0, 7)
    const after = melds.concat([{ rank, cards: give }])
    if (!place(give.length, after)) continue
    return { type: "meld", cardIds: give.map((card) => card.id) }
  }

  if (kinds.pure >= 1 && kinds.mixed < 1 && wilds.length) {
    const dirty = melds.find(
      (meld) =>
        meld.rank > 0 &&
        meld.cards.some(isWild) &&
        meld.cards.length < 7 &&
        meld.cards.filter(isWild).length < 3
    )
    if (dirty) {
      const after = melds.map((meld) => (meld === dirty ? { rank: meld.rank, cards: meld.cards.concat([wilds[0]]) } : meld))
      if (place(1, after)) return { type: "layoff", cardIds: [wilds[0].id], rank: dirty.rank }
    }
    const starter = melds.find(
      (meld) => meld.rank > 0 && !meld.cards.some(isWild) && meld.cards.length >= 6 && meld.cards.length < 7
    )
    if (starter) {
      const after = melds.map((meld) => (meld === starter ? { rank: meld.rank, cards: meld.cards.concat([wilds[0]]) } : meld))
      if (place(1, after)) return { type: "layoff", cardIds: [wilds[0].id], rank: starter.rank }
    }
    for (const [rank, cards] of naturalsOf(hand)) {
      if (cards.length < 2 || melds.some((meld) => meld.rank === rank)) continue
      if (!place(3, melds.concat([{ rank, cards: cards.slice(0, 2).concat(wilds[0]) }]))) continue
      return { type: "meld", cardIds: [cards[0].id, cards[1].id, wilds[0].id] }
    }
  }
  return null
}

function nextImprovement(state) {
  const hand = seat(state).hand
  const melds = side(state).melds
  const have = countCanastas(melds)

  const lay = (cards, rank) => {
    if (!cards.length) return null
    const meld = melds.find((item) => item.rank === rank)
    if (!meld) return null
    const completes = meld.cards.length < 7 && meld.cards.length + cards.length >= 7
    if (!canPlace(state, cards.length, completes || have >= canastasNeeded(state))) return null
    return { type: "layoff", cardIds: cards.map((card) => card.id), rank }
  }

  for (const meld of melds) {
    if (meld.rank === 3 || meld.rank < 0 || meld.cards.length >= 7) continue
    const naturals = hand.filter((card) => card.rank === meld.rank).slice(0, 7 - meld.cards.length)
    const wildsOn = meld.cards.filter(isWild).length
    if (meld.cards.length >= 5 && naturals.length) {
      const action = lay(naturals, meld.rank)
      if (action) return action
    }
    if (meld.cards.length >= 6 && !naturals.length && wildsOn < 3 && !(state.rules === "house" && wildsOn === 0 && canastaBreakdown(melds).pure < 1)) {
      const wild = hand.find((card) => card.rank === 2) || hand.find(isWild)
      if (wild) {
        const action = lay([wild], meld.rank)
        if (action) return action
      }
    }
    if (naturals.length >= 3) {
      const action = lay(naturals, meld.rank)
      if (action) return action
    }
  }

  for (const [rank, cards] of naturalsOf(hand)) {
    if (cards.length < 3 || melds.some((meld) => meld.rank === rank)) continue
    const give = cards.slice(0, 7)
    const completes = give.length >= 7
    if (!canPlace(state, give.length, completes)) continue
    return { type: "meld", cardIds: give.map((card) => card.id) }
  }
  return null
}

function readyToLeave(state) {
  if (state.rules === "house") return meetsGoOut(state, side(state).melds) && !footWaiting(state)
  return countCanastas(side(state).melds) >= canastasNeeded(state)
}

function shouldDump(state) {
  if (!readyToLeave(state)) return false
  if (state.rules === "house" || state.stock.length === 0) return true
  if (state.stock.length > 12) return false
  const ally = partner(state)
  if (ally && ally.hand.length > 8) return false
  return true
}

function dumpAction(state) {
  const hand = seat(state).hand
  const melds = side(state).melds
  const wild = hand.find((card) => card.rank === 2) || hand.find(isWild)
  const keepWilds = state.rules === "house" && canastaBreakdown(melds).wild < 1
  for (const [rank, cards] of naturalsOf(hand)) {
    const meld = melds.find((item) => item.rank === rank)
    if (meld && cards.length && meld.cards.length < 7) {
      const give = cards.slice(0, 7 - meld.cards.length)
      const completes = meld.cards.length + give.length >= 7
      if (canPlace(state, give.length, completes)) return { type: "layoff", cardIds: give.map((card) => card.id), rank }
    }
    if (!meld && cards.length >= 2 && wild && !keepWilds && canPlace(state, 3, false)) {
      return { type: "meld", cardIds: [cards[0].id, cards[1].id, wild.id] }
    }
  }
  if (wild && !keepWilds) {
    const target = melds.find(
      (meld) => meld.rank > 0 && meld.cards.length >= 6 && meld.cards.length < 7 && meld.cards.filter(isWild).length < 3
    )
    if (target && canPlace(state, 1, true)) return { type: "layoff", cardIds: [wild.id], rank: target.rank }
  }
  return null
}

function playMelds(sim, step) {
  if (!side(sim).opened) {
    const plan = openingPlan(sim, null)
    if (plan) {
      if (plan.discardId) {
        const going = step({ type: "open", groups: plan.groups, discardId: plan.discardId })
        if (going.ok) return
      }
      const opened = step({ type: "open", groups: plan.groups })
      if (!opened.ok && plan.discardId) return
    }
  }
  for (let guard = 0; guard < 20; guard++) {
    if (sim.phase !== "meld") return
    const action = houseAction(sim) || nextImprovement(sim) || (shouldDump(sim) ? dumpAction(sim) : null)
    if (!action) return
    if (!step(action).ok) return
  }
}

function closeAction(state) {
  if (state.phase !== "meld") return null
  if (state.rules === "house") {
    if (footWaiting(state) || !meetsGoOut(state, side(state).melds)) return null
  } else if (countCanastas(side(state).melds) < canastasNeeded(state)) return null
  const hand = seat(state).hand
  const ally = partner(state)
  const near = state.rules === "house" ? false : [...naturalsOf(hand)].some(([rank, cards]) => {
    const meld = side(state).melds.find((item) => item.rank === rank)
    const total = cards.length + (meld ? meld.cards.filter((card) => card.rank === rank).length : 0)
    return total >= 6 && (!meld || meld.cards.length < 7)
  })
  if (near && state.stock.length > 8 && !(ally && ally.hand.length <= 3)) return null
  if (ally && ally.hand.length > 9 && state.stock.length > 8) return null
  const blacks = hand.filter(isBlackThree)
  const others = hand.filter((card) => !isBlackThree(card))
  const blackOk = blacks.length === 0 || (blacks.length >= 3 && blacks.length <= 4)
  if (!others.length && blackOk) return { type: "goOut", cardId: null }
  if (others.length === 1 && blackOk) return { type: "goOut", cardId: others[0].id }
  return null
}

function discardScore(state, card) {
  if (isRedThree(card)) return -1000
  if (isWild(card)) return -90
  if (isBlackThree(card)) return 100
  const hand = seat(state).hand
  const count = hand.filter((item) => item.rank === card.rank).length
  const frozen = state.discard.some((item) => isWild(item) || isRedThree(item))
  let score = 14 - Math.min(cardPoints(card), 20)
  if (count >= 2) score -= 40
  for (const team of state.teams) {
    if (team === side(state) || !team.opened) continue
    for (const meld of team.melds) {
      if (meld.rank !== card.rank) continue
      if (meld.cards.length >= 7) score += 55
      else if (!frozen) score -= 50
    }
  }
  return score
}

function discardAction(state) {
  const hand = seat(state).hand
  if (!hand.length) return footWaiting(state) ? null : { type: "goOut", cardId: null }
  if (hand.length === 1 && (readyToLeave(state) || footWaiting(state))) {
    return { type: "discard", cardId: hand[0].id }
  }
  let best = null
  let bestScore = -Infinity
  for (const card of hand) {
    const score = discardScore(state, card)
    if (score > bestScore) {
      bestScore = score
      best = card
    }
  }
  return best ? { type: "discard", cardId: best.id } : null
}

export function planTurn(state) {
  const sim = structuredClone(state)
  if (sim.turnState) sim.turnState.snapshot = null
  const actions = []
  const me = sim.turn
  const step = (action) => {
    const result = apply(sim, action)
    if (result.ok) actions.push(action)
    return result
  }
  const mine = () => sim.turn === me && (sim.phase === "draw" || sim.phase === "meld")

  if (sim.phase === "draw" && sim.turn === me) {
    if (sim.mayDecline && !takeAction(sim)) {
      const declined = step({ type: "decline" })
      if (!declined.ok) return { ok: false, error: declined.error }
    } else {
      const take = takeAction(sim)
      const drawn = take ? step(take) : { ok: false }
      if (!drawn.ok) {
        const fallback = sim.stock.length ? step({ type: "draw" }) : step({ type: "decline" })
        if (!fallback.ok) return { ok: false, error: fallback.error || drawn.error }
      }
    }
  }

  if (sim.phase === "meld" && sim.turn === me) playMelds(sim, step)
  if (sim.phase === "meld" && sim.turn === me) {
    const closing = closeAction(sim)
    if (closing) step(closing)
  }
  if (sim.phase === "meld" && sim.turn === me) {
    const discarding = discardAction(sim)
    let result = discarding ? step(discarding) : { ok: false, error: "No discard." }
    if (!result.ok) {
      let done = false
      for (const card of sim.players[me].hand.slice()) {
        const attempt = apply(sim, { type: "discard", cardId: card.id })
        if (attempt.ok) {
          actions.push({ type: "discard", cardId: card.id })
          done = true
          break
        }
      }
      if (!done) {
        const out = apply(sim, { type: "goOut", cardId: null })
        if (out.ok) actions.push({ type: "goOut", cardId: null })
        else return { ok: false, error: result.error || "AI could not finish the turn." }
      }
    }
  }

  if (mine() && (sim.phase === "draw" || sim.phase === "meld") && sim.turn === me) {
    return { ok: false, error: "AI turn did not end." }
  }
  return { ok: true, actions }
}
