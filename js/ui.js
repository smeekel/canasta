import { planTurn } from "./ai.js"
import {
  apply,
  canastaBreakdown,
  canastasNeeded,
  cardName,
  countCanastas,
  createMatch,
  describeMeld,
  discardInfo,
  freezeCard,
  isBlackThree,
  isNatural,
  isWild,
  meetsGoOut,
  openingRequirement,
  rankLabel,
  sideName,
  sortHand,
  suitSymbol,
} from "./engine.js"

const app = document.querySelector("#app")
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
const explain = {
  classic: {
    1: "Two-player Canasta. Fifteen cards each, draw two, and two canastas are required to go out.",
    2: "Three-player cutthroat. Thirteen cards each, and everyone scores alone.",
    3: "Classic four-handed partnerships. You play with Ellis, across the table, against Mina and Noah.",
  },
  house: {
    1: "You and Mina, each for yourself. Three decks, a hand and a foot, and one of each canasta to go out.",
    2: "You, Mina, and Ellis, each for yourself. Four decks, and nobody has a partner.",
    3: "Four players, each for yourself. Five decks. Partnerships are not used.",
  },
}

const SPEED_NAMES = ["Slowest", "Slow", "Medium", "Fast", "Fastest"]
const SPEED_MS = [980, 700, 460, 280, 150]

function loadSpeed() {
  try {
    const saved = Number(localStorage.getItem("canasta-motion"))
    if (saved >= 1 && saved <= 5) return saved
  } catch {
    /* keep the default when storage is unavailable */
  }
  return 3
}

const ui = {
  screen: "lobby",
  rules: "house",
  speed: loadSpeed(),
  opponents: 3,
  selected: new Set(),
  staged: [],
  taking: false,
  focusRank: null,
  error: "",
  busy: false,
  modal: null,
  summarize: false,
  handScroll: 0,
}

let match = null
let lastPhase = null

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function me() {
  return match.players[0]
}

function myTeam() {
  return match.teams[me().team]
}

function myHand() {
  return me().hand
}

function selectedCards() {
  const hand = myHand()
  return [...ui.selected].map((id) => hand.find((card) => card.id === id)).filter(Boolean)
}

function cardMarkup(card, { tag = "span", small = false, selected = false, extra = "", attrs = "" } = {}) {
  const joker = card.rank === 0
  const red = card.suit === "h" || card.suit === "d" || (joker && card.suit === "r")
  const classes = ["card", red ? "red" : "black", joker ? "joker" : "", small ? "sm" : "", selected ? "sel" : "", extra]
    .filter(Boolean)
    .join(" ")
  const cid = card.id != null && !String(extra).includes("ghost") ? ` data-cid="${card.id}"` : ""
  const open = tag === "button" ? `<button type="button" class="${classes}" aria-label="${esc(cardName(card))}" aria-pressed="${selected}" ${attrs}${cid}>` : `<span class="${classes}" aria-hidden="true" ${attrs}${cid}>`
  const close = tag === "button" ? "</button>" : "</span>"
  if (joker) return `${open}<span class="j-star">★</span><span class="j-word">Joker</span>${close}`
  const rank = rankLabel(card)
  const suit = suitSymbol(card)
  const face = card.rank === 1 || card.rank > 10
  return `${open}<span class="c-tl"><b>${rank}</b><i>${suit}</i></span><span class="c-mid${face ? " face" : ""}">${face ? rank : suit}</span><span class="c-br"><b>${rank}</b><i>${suit}</i></span>${close}`
}

function backs(count) {
  const shown = Math.min(4, count)
  return `<div class="backs" aria-hidden="true">${Array.from({ length: shown }, () => `<span class="card back sm"></span>`).join("")}</div>`
}

function redMarks(cards) {
  if (!cards.length) return ""
  return `<span class="reds" title="${cards.length} red three${cards.length === 1 ? "" : "s"}">${"♦".repeat(Math.min(4, cards.length))}</span>`
}

function meldKind(meld) {
  if (meld.rank === 3 || meld.cards.length < 7) return ""
  if (meld.rank < 0) return "Wild canasta"
  if (meld.cards.some(isWild)) return "Mixed canasta"
  return "Pure canasta"
}

function meldView(meld, mine) {
  const canasta = meld.cards.length >= 7 && meld.rank !== 3
  const mixed = canasta && meld.rank >= 0 && meld.cards.some(isWild)
  const wild = canasta && meld.rank < 0
  const classes = ["meld", canasta ? "canasta" : "", mixed ? "mixed" : "", wild ? "wild" : "", mine && ui.focusRank === meld.rank ? "on" : ""]
    .filter(Boolean)
    .join(" ")
  const kind = meldKind(meld)
  const attrs = mine ? `data-act="focus" data-rank="${meld.rank}"` : ""
  const title = kind ? ` title="${kind}"` : ""
  const cards = meld.cards.map((card) => cardMarkup(card, { small: true })).join("")
  const badge = `<span class="badge">${meld.cards.length}</span>`
  const anchor = `data-anchor="meld" data-rank="${meld.rank}"`
  const open = mine ? `<button type="button" class="${classes}" ${attrs}${title} ${anchor}>` : `<div class="${classes}"${title} ${anchor}>`
  return `${open}${cards}${badge}${mine ? "</button>" : "</div>"}`
}

function seatView(index) {
  const player = match.players[index]
  const active = match.turn === index && (match.phase === "draw" || match.phase === "meld")
  const partner = match.rules !== "house" && match.playerCount === 4 && index === 2
  const label = partner ? `${player.name} · partner` : player.name
  const foot = player.foot?.length ? ` · foot ${player.foot.length}` : ""
  return `<article class="seat${active ? " active" : ""}" data-anchor="seat-${index}">`
    <div class="who"><strong>${esc(label)}</strong><span>${player.hand.length}${foot}</span></div>
    ${backs(player.hand.length)}
  </article>`
}

function meldZone(title, melds, reds, mine, anchor) {
  const body = melds.length
    ? `<div class="melds">${melds.map((meld) => meldView(meld, mine)).join("")}</div>`
    : `<p class="empty-note">No melds yet</p>`
  return `<section class="zone" data-anchor="${anchor}"><div class="meld-head"><span>${esc(title)}</span>${redMarks(reds)}</div>${body}</section>`
}

function opponentZones() {
  if (match.rules !== "house" && match.playerCount === 4) {
    const theirs = match.teams[1]
    return meldZone("Opponents", theirs.melds, theirs.redThrees, false, "zone-1")
  }
  return match.players
    .filter((player) => !player.isHuman)
    .map((player) => meldZone(player.name, match.teams[player.team].melds, match.teams[player.team].redThrees, false, `zone-${player.team}`))
    .join("")
}

function myZone() {
  const title = match.rules !== "house" && match.playerCount === 4 ? "Your side" : "Your melds"
  return meldZone(title, myTeam().melds, myTeam().redThrees, true, `zone-${me().team}`)
}

function stagedPreview() {
  if (!ui.staged.length && !ui.taking) return ""
  const top = ui.taking ? match.discard.at(-1) : null
  let usedTop = false
  let points = 0
  const groups = ui.staged
    .map((ids, index) => {
      const cards = ids.map((id) => myHand().find((card) => card.id === id)).filter(Boolean)
      const matches = top && !usedTop && cards.some((card) => isNatural(card) && card.rank === top.rank)
      const shown = matches ? [...cards, top] : cards
      if (matches) usedTop = true
      const parsed = describeMeld(shown, false, match.rules === "house")
      if (parsed.ok) points += parsed.points
      return `<div class="stage-group">${shown.map((card) => cardMarkup(card, { small: true, extra: card === top ? "ghost" : "" })).join("")}<button type="button" class="x" data-act="unstage" data-index="${index}">×</button></div>`
    })
    .join("")
  const need = openingRequirement(myTeam().total)
  const note = myTeam().opened ? "" : ` <span>${points} / ${need}</span>`
  return `<div class="stage"><div class="meld-head"><span>${ui.taking ? "Taking the discard" : "Opening meld"}${note}</span></div><div class="stage-row">${groups || "<p class=\"empty-note\">Select cards, then add a meld.</p>"}</div></div>`
}

function piles() {
  const top = match.discard.at(-1)
  const freezer = freezeCard(match)
  const frozen = !!freezer
  const peek = freezer && freezer !== top ? cardMarkup(freezer, { small: true, extra: "peek" }) : ""
  const face = top ? cardMarkup(top, { extra: "show" }) : `<span class="card empty">Empty</span>`
  const info = discardInfo(match, 0)
  const stockOff = match.turn !== 0 || match.phase !== "draw" || ui.taking || match.mayDecline ? "disabled" : ""
  const pileOff = match.turn !== 0 || match.phase !== "draw" || ui.taking ? "disabled" : ""
  return `<div class="piles">
    <button type="button" class="pile" data-act="stock" data-anchor="stock" ${stockOff}><span class="stack"><span class="card back"></span></span><span class="pile-meta"><b>${match.stock.length}</b>Stock</span></button>
    <button type="button" class="pile${frozen ? " frozen" : ""}" data-act="pile" data-anchor="discard" ${pileOff} title="${esc(info.reason)}"><span class="stack">${peek}${face}</span><span class="pile-meta"><b>${match.discard.length}</b>${frozen ? "Frozen" : "Discard"}</span></button>
  </div>`
}

function scoreText() {
  return match.teams
    .map((team, index) => `<span>${esc(sideName(match, index))} <b>${team.total}</b></span>`)
    .join("")
}

function hint() {
  if (ui.error) return ui.error
  if (!match) return ""
  if (match.phase === "handEnd") return "Hand scored. Deal the next one when you are ready."
  if (match.phase === "matchEnd") return "That is the match."
  const player = match.players[match.turn]
  if (!player.isHuman) return `${player.name} is playing…`
  if (ui.taking) return "Choose a natural pair that matches the discard. Add more melds if you still need points."
  if (match.phase === "draw") {
    if (match.mayDecline) return "The stock is empty. Take the discard, or end the hand."
    const info = discardInfo(match, 0)
    const draw = match.rules === "house" ? "Draw two cards from the stock" : "Draw from the stock"
    return info.canTake ? `${draw}, or take the discard pile.` : `${draw}. ${info.reason}`
  }
  const team = myTeam()
  if (!team.opened) return `Your opening meld needs ${openingRequirement(team.total)} points. You can also discard without melding.`
  if (match.rules === "house") {
    const tally = canastaBreakdown(team.melds)
    const bits = `Pure ${tally.pure} · Mixed ${tally.mixed} · Wild ${tally.wild}`
    if (me().foot.length) return `${bits}. Your foot is still face down.`
    if (!meetsGoOut(match, team.melds)) return `${bits}. One of each canasta lets you go out.`
    return `${bits}. You can go out.`
  }
  const have = countCanastas(team.melds)
  const need = canastasNeeded(match)
  if (have < need) return need === 2 ? "You need two canastas before you can go out." : "You need a canasta of 7 before you can go out."
  return "You may go out by melding the rest of your hand."
}

function buttons() {
  const list = []
  if (match.phase === "handEnd") list.push(["next", "Next hand", true])
  if (match.phase === "matchEnd") list.push(["again", "Play again", true])
  const mine = match.turn === 0 && (match.phase === "draw" || match.phase === "meld")
  if (!mine) return list
  if (match.phase === "draw") {
    if (ui.taking) {
      list.push(["stage", "Add meld", false], ["take", "Take pile", true], ["cancel-take", "Cancel", false])
      return list
    }
    const info = discardInfo(match, 0)
    if (match.mayDecline) {
      if (info.canTake) list.push(["pile", "Take discard", true])
      list.push(["decline", "End hand", false])
      return list
    }
    list.push(["stock", "Draw", true])
    if (info.canTake) list.push(["pile", info.mode === "layoff" ? "Take discard" : "Take with cards", false])
    return list
  }
  const team = myTeam()
  if (!team.opened) {
    list.push(["stage", "Add meld", false], ["open", "Open", true])
    if (ui.staged.length) list.push(["clear", "Clear", false])
    else list.push(["discard-btn", "Discard", false])
    list.push(["undo", "Undo", false])
    return list
  }
  const cards = selectedCards()
  if (cards.length) list.push(["meld-btn", layoffRank(cards) == null ? "Meld" : "Add to meld", true])
  list.push(["discard-btn", myHand().length === 1 ? "Discard & go out" : "Discard", false])
  const canLeave = match.rules === "house" ? meetsGoOut(match, team.melds) && !me().foot.length : countCanastas(team.melds) >= canastasNeeded(match)
  if (canLeave) list.push(["go", "Go out", true])
  list.push(["undo", "Undo", false])
  return list
}

function layoffRank(cards) {
  if (match.rules === "house" && cards.length && cards.every(isWild)) {
    const wilds = myTeam().melds.filter((meld) => meld.rank < 0)
    const incomplete = wilds.find((meld) => meld.cards.length < 7)
    if (incomplete) return incomplete.rank
    if (ui.focusRank < 0 && wilds.some((meld) => meld.rank === ui.focusRank)) return ui.focusRank
  }
  const naturals = cards.filter(isNatural)
  if (naturals.length && naturals.some((card) => card.rank !== naturals[0].rank)) return null
  const rank = naturals.length ? naturals[0].rank : ui.focusRank
  if (rank == null) return null
  if (!cards.every((card) => isWild(card) || card.rank === rank)) return null
  return myTeam().melds.some((meld) => meld.rank === rank) ? rank : null
}

function rulesHtml() {
  const house = (match?.rules || ui.rules) === "house"
  const body = house
    ? `<p>House rules is one game. Everyone scores alone, even with four players. The pack is one more deck than there are players, and each deck is 52 cards plus two jokers. Jokers and twos are wild.</p>
    <ul>
      <li>You are dealt 13 cards and a face-down foot of 13. Draw two cards, meld if you want, then discard one.</li>
      <li>Playing the last card of your hand picks up the foot. Discarding that card ends the turn. Melding it lets you continue.</li>
      <li>A pure canasta is seven or more cards of one rank and no wilds (500). A mixed canasta includes a wild (300). A wild canasta is seven or more wild cards (1,500). You may make as many as you like.</li>
      <li>To go out, have at least one of each canasta, then play every card in your hand and your foot. The game also ends when the stock is used up.</li>
      <li>Opening counts, frozen piles, red threes, and black threes follow classic Canasta. Red threes score 100 each, or 200 each if you collect every red three in the pack.</li>
    </ul>`
    : `<p>A match is four hands. The highest score at the end wins. This is classic Canasta: two decks plus four jokers. Jokers and twos are wild. You meld sets, never sequences.</p>
    <ul>
      <li>With one opponent, draw two cards and make two canastas to go out. With two opponents, everyone plays alone. With three, you and Ellis are partners.</li>
      <li>On your turn, draw from the stock or take the whole discard pile, meld if you want, then discard one card.</li>
      <li>A meld needs at least two natural cards and at most three wild cards. A canasta is seven or more: 500 if it has no wilds, 300 if it does.</li>
      <li>Red threes are bonuses. They are tabled automatically. Four of them score 800, and they count against a side that never melds.</li>
      <li>The pile is frozen until your side opens, and whenever a wild card or red three is in it. A frozen pile can be taken only with a natural pair. A black three on top only blocks the next take.</li>
      <li>The first meld must total 15, 50, 90, or 120 points as your score rises. Going out scores 100, or 200 if you go out concealed on the same turn you first meld.</li>
    </ul>`
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="rules-title">
    <h2 id="rules-title">How to play</h2>
    ${body}
    <div class="actions"><button type="button" class="primary" data-act="close">Back to the table</button></div>
  </section></div>`
}

function scoreHtml() {
  const rows = match.history
    .map((hand) => {
      const line = hand.lines.map((item) => `${esc(item.name)} ${item.delta >= 0 ? "+" : ""}${item.delta}`).join(" · ")
      return `<div class="row"><span>Hand ${hand.hand}</span><span>${line}</span></div>`
    })
    .join("")
  const totals = match.teams
    .map((team, index) => `<div class="row total"><span>${esc(sideName(match, index))}</span><b>${team.total}</b></div>`)
    .join("")
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="score-title">
    <h2 id="score-title">Score</h2>
    ${rows || "<p>No hands have been scored yet.</p>"}
    ${totals}
    <div class="actions"><button type="button" data-act="lobby">New match</button><button type="button" class="primary" data-act="close">Close</button></div>
  </section></div>`
}

function summaryHtml() {
  const hand = match.handSummary
  const reason =
    hand.reason === "out"
      ? `${esc(hand.outName)} went out${hand.concealed ? " concealed" : ""}.`
      : hand.reason === "red3"
        ? "The last card of the stock was a red three."
        : "The stock ran out."
  const lines = hand.lines
    .map((item) => {
      const bits = [
        item.natural ? `${item.natural} pure canasta` : "",
        item.mixed ? `${item.mixed} mixed canasta` : "",
        item.wild ? `${item.wild} wild canasta` : "",
        item.going ? `going out ${item.going}` : "",
        `red threes ${item.redScore >= 0 ? "+" : ""}${item.redScore}`,
        `melded ${item.melded}`,
        `in hand −${item.penalty}`,
      ].filter(Boolean)
      return `<div class="row"><span><strong>${esc(item.name)}</strong><br>${esc(bits.join(" · "))}</span><b>${item.delta >= 0 ? "+" : ""}${item.delta}</b></div>`
    })
    .join("")
  const done = match.phase === "matchEnd"
  const winner = done ? `<p class="total">${esc(winnerText())}</p>` : ""
  const heading = done ? (match.rules === "house" ? "Game over" : "Match over") : `Hand ${hand.hand} of 4`
  const next = done
    ? `<button type="button" class="primary" data-act="again">Play again</button>`
    : `<button type="button" class="primary" data-act="next">Next hand</button>`
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="sum-title">
    <h2 id="sum-title">${heading}</h2>
    <p>${reason}</p>
    ${lines}
    ${winner}
    <div class="actions"><button type="button" data-act="close">Look at the table</button>${next}</div>
  </section></div>`
}

function winnerText() {
  const ranked = match.teams
    .map((team, index) => ({ name: sideName(match, index), total: team.total }))
    .sort((a, b) => b.total - a.total)
  if (ranked.length > 1 && ranked[0].total === ranked[1].total) return "The match is a tie."
  const verb = ranked[0].name === "You" || ranked[0].name === "Your side" ? "win" : "wins"
  return `${ranked[0].name} ${verb} by ${ranked[0].total - ranked[1].total}.`
}

function lobbyHtml() {
  const choices = [1, 2, 3]
    .map((count) => `<button type="button" class="choice${ui.opponents === count ? " on" : ""}" data-opponents="${count}"><b>${count}</b><span>${count === 1 ? "opponent" : "opponents"}</span></button>`)
    .join("")
  const modes = [
    ["classic", "Classic", "Four hands"],
    ["house", "House rules", "Everyone solo"],
  ]
    .map(
      ([id, title, note]) =>
        `<button type="button" class="choice${ui.rules === id ? " on" : ""}" data-rules="${id}"><b>${title}</b><span>${note}</span></button>`
    )
    .join("")
  const sample = [
    { rank: 1, suit: "s", deck: 0 },
    { rank: 13, suit: "h", deck: 0 },
    { rank: 12, suit: "d", deck: 0 },
    { rank: 0, suit: "r", deck: 0 },
  ]
  const house = ui.rules === "house"
  return `<main class="lobby"><section class="panel">
    <p class="eyebrow">${house ? "House rules" : "Classic"}</p>
    <h1>Canasta</h1>
    <p class="lede">${house ? "One game, a bigger pack, and a foot. You, and up to three opponents." : "Four hands on a green table. You, and up to three opponents."}</p>
    <div class="fan" aria-hidden="true">${sample.map((card) => cardMarkup(card)).join("")}</div>
    <div class="choices modes" role="group" aria-label="Rules">${modes}</div>
    <div class="choices" role="group" aria-label="Number of AI opponents">${choices}</div>
    <p class="explain">${esc(explain[ui.rules][ui.opponents])}</p>
    ${speedControl()}
    <div class="lobby-actions">
      <button type="button" class="primary" data-act="start">Deal the first hand</button>
      <button type="button" class="ghost" data-act="rules">How to play</button>
    </div>
  </section></main>`
}

function tableHtml() {
  const opponents = match.players.map((_, index) => index).filter((index) => index !== 0)
  const stagedIds = new Set(ui.staged.flat())
  const hand = sortHand(myHand().filter((card) => !stagedIds.has(card.id)))
  const yourTurn = match.turn === 0 && (match.phase === "draw" || match.phase === "meld")
  const log = match.log.slice(-3).map((line) => `<li>${esc(line)}</li>`).join("")
  const actions = buttons()
    .map(([id, label, primary]) => `<button type="button" class="${primary ? "primary" : "ghost"}" data-act="${id}">${esc(label)}</button>`)
    .join("")
  const foot = match.rules === "house" && me().foot.length ? `<div class="foot-row" data-anchor="foot">${backs(me().foot.length)}<span>Your foot · ${me().foot.length}</span></div>` : ""
  const dealLabel = match.rules === "house" ? "House rules" : `Hand ${match.handNumber} of 4`
  return `<main class="shell${yourTurn ? " your-turn" : ""}">
    <header class="topbar"><div class="brand">${match.rules === "house" ? "House Canasta" : "Canasta"}</div><div class="top-actions">${speedControl()}<button type="button" class="ghost" data-act="scores">Score</button><button type="button" class="ghost" data-act="rules">Rules</button></div></header>
    <div class="scoreline"><span>${dealLabel}</span><span>${scoreText()}</span></div>
    <section class="seats">${opponents.map(seatView).join("")}</section>
    ${opponentZones()}
    ${piles()}
    ${myZone()}
    ${stagedPreview()}
    <p class="hint${ui.error ? " warn" : ""}" role="status">${esc(hint())}</p>
    <ul class="log">${log}</ul>
    ${foot}
    <div class="hand-scroll"><div class="hand${hand.length > 12 ? " tight" : ""}" data-anchor="hand">${hand
      .map((card) => cardMarkup(card, { tag: "button", selected: ui.selected.has(card.id), attrs: `data-act="card" data-id="${card.id}"` }))
      .join("")}</div></div>
    <div class="actions">${actions}</div>
  </main>`
}

function modalHtml() {
  if (ui.modal === "rules") return rulesHtml()
  if (ui.modal === "scores" && match) return scoreHtml()
  if (ui.modal === "summary" && match?.handSummary) return summaryHtml()
  return ""
}

function speedControl() {
  return `<label class="speed"><span>Speed</span><input type="range" min="1" max="5" step="1" value="${ui.speed}" data-act="speed" aria-label="Card speed" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${ui.speed}"><span data-speed-label>${SPEED_NAMES[ui.speed - 1]}</span></label>`
}

function motionMs() {
  if (reduceMotion) return 0
  return SPEED_MS[ui.speed - 1] ?? SPEED_MS[2]
}

function cardPlaces(state) {
  const places = new Map()
  const put = (card, place) => {
    if (card) places.set(card.id, place)
  }
  for (const card of state.stock) put(card, { kind: "stock" })
  state.discard.forEach((card, index) => put(card, { kind: "discard", top: index === state.discard.length - 1 }))
  state.players.forEach((player, seat) => {
    for (const card of player.hand) put(card, { kind: "hand", seat })
    for (const card of player.foot || []) put(card, { kind: "foot", seat })
  })
  state.teams.forEach((team, teamId) => {
    for (const card of team.redThrees) put(card, { kind: "reds", team: teamId })
    for (const meld of team.melds) {
      for (const card of meld.cards) put(card, { kind: "meld", team: teamId, rank: meld.rank })
    }
  })
  return places
}

function cardById(id) {
  const piles = [
    ...match.stock,
    ...match.discard,
    ...match.players.flatMap((player) => [...player.hand, ...(player.foot || [])]),
    ...match.teams.flatMap((team) => [...team.redThrees, ...team.melds.flatMap((meld) => meld.cards)]),
  ]
  return piles.find((card) => card.id === id) || null
}

function anchorKey(place) {
  if (!place) return "stock"
  if (place.kind === "stock") return "stock"
  if (place.kind === "discard") return "discard"
  if (place.kind === "foot" && place.seat === 0) return "foot"
  if (place.kind === "hand" && place.seat === 0) return "hand"
  if (place.kind === "hand" || place.kind === "foot") return `seat-${place.seat}`
  if (place.kind === "meld") return `meld-${place.rank}`
  if (place.kind === "reds") return `zone-${place.team}`
  return "stock"
}

function anchorElement(key) {
  if (key.startsWith("meld-")) return document.querySelector(`[data-anchor="meld"][data-rank="${key.slice(5)}"]`)
  return document.querySelector(`[data-anchor="${key}"]`)
}

function anchorBox(el) {
  if (!el) return null
  const tight = el.querySelector(".stack, .backs, .reds")
  const tightRect = tight?.getBoundingClientRect()
  const rect = tightRect && tightRect.width >= 2 ? tightRect : el.getBoundingClientRect()
  return boxOf(rect)
}

function captureLayout() {
  const cards = new Map()
  const anchors = new Map()
  document.querySelectorAll("[data-cid]").forEach((el) => {
    if (el.closest(".flyer")) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0) cards.set(Number(el.dataset.cid), rect)
  })
  document.querySelectorAll("[data-anchor]").forEach((el) => {
    const key = el.dataset.anchor === "meld" ? `meld-${el.dataset.rank}` : el.dataset.anchor
    const box = anchorBox(el)
    if (box) anchors.set(key, box)
  })
  return { cards, anchors }
}

function boxOf(rect) {
  if (!rect || rect.width < 2) return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function lookupRect(key, layout) {
  if (layout?.anchors?.has(key)) return layout.anchors.get(key)
  return anchorBox(anchorElement(key))
}

function dealMoves() {
  const moves = []
  const player = match.players[0]
  for (const card of sortHand(player.hand)) {
    moves.push({ id: card.id, card, from: { kind: "stock" }, to: { kind: "hand", seat: 0 } })
  }
  const top = match.discard.at(-1)
  if (top) moves.push({ id: top.id, card: top, from: { kind: "stock" }, to: { kind: "discard", top: true } })
  if (player.foot?.length) moves.push({ packet: true, from: { kind: "stock" }, to: { kind: "foot", seat: 0 } })
  for (let seat = 1; seat < match.playerCount; seat++) {
    moves.push({ packet: true, from: { kind: "stock" }, to: { kind: "hand", seat } })
    if (match.players[seat].foot?.length) moves.push({ packet: true, from: { kind: "stock" }, to: { kind: "foot", seat } })
  }
  match.teams.forEach((team, teamId) => {
    for (const card of team.redThrees) moves.push({ id: card.id, card, from: { kind: "stock" }, to: { kind: "reds", team: teamId } })
  })
  return moves
}

function movesBetween(before, after, action) {
  if (action.type === "deal" || action.type === "next") return dealMoves()
  const moves = []
  for (const [id, to] of after) {
    const from = before.get(id)
    if (!from) continue
    if (from.kind === to.kind && from.seat === to.seat && from.team === to.team && String(from.rank ?? "") === String(to.rank ?? "")) continue
    if (from.kind === "discard" && to.kind === "discard") continue
    if (from.kind === "stock" && to.kind === "stock") continue
    moves.push({ id, card: cardById(id), from, to })
  }
  const rank = (move) => {
    if (move.to.kind === "meld") return 0
    if (move.to.kind === "hand" && move.to.seat === 0) return 1
    if (move.to.kind === "discard") return 2
    return 3
  }
  moves.sort((a, b) => rank(a) - rank(b))
  return moves.length > 18 ? moves.slice(0, 18) : moves
}

function faceUp(place) {
  if (!place) return false
  if (place.kind === "stock" || place.kind === "foot") return false
  if ((place.kind === "hand" || place.kind === "foot") && place.seat !== 0) return false
  return true
}

function specificCard(move) {
  if (move.packet || move.id == null) return false
  if (move.to.kind === "meld" || move.to.kind === "discard") return true
  return move.to.kind === "hand" && move.to.seat === 0
}

let flightGen = 0

function animateMoves(moves, layout) {
  const duration = motionMs()
  if (!moves.length || duration === 0) return Promise.resolve()
  const token = ++flightGen
  document.querySelectorAll(".flyer").forEach((node) => node.remove())
  const groups = new Map()
  const prepared = []
  for (const move of moves) {
    const key = anchorKey(move.from)
    const source = !move.packet && move.from?.kind !== "stock" && layout.cards.has(move.id) ? boxOf(layout.cards.get(move.id)) : lookupRect(key, layout)
    let dest = null
    if (specificCard(move)) dest = boxOf(document.querySelector(`.shell [data-cid="${move.id}"]`)?.getBoundingClientRect())
    if (!dest) dest = lookupRect(anchorKey(move.to), null)
    if (!source || !dest) continue
    const bunch = groups.get(key) || []
    groups.set(key, bunch)
    prepared.push({ move, source, dest, bunch: bunch.length })
    bunch.push(move)
  }
  let maxDelay = 0
  const wide = prepared.length <= 6
  prepared.forEach((item, index) => {
    const delay = Math.round(index * (wide ? duration * 0.42 : Math.min(32, duration * 0.06)))
    maxDelay = delay
    const from = {
      left: item.source.left + (item.bunch - (groups.get(anchorKey(item.move.from)).length - 1) / 2) * 16,
      top: item.source.top + item.bunch * 5,
      width: item.source.width,
      height: item.source.height,
    }
    const endFace = faceUp(item.move.to)
    const startFace = faceUp(item.move.from)
    if (specificCard(item.move)) document.querySelector(`.shell [data-cid="${item.move.id}"]`)?.classList.add("flying-target")
    const flyer = document.createElement("div")
    flyer.className = "flyer"
    const turn = document.createElement("div")
    turn.className = "turn"
    const front = document.createElement("div")
    front.className = "side"
    const rear = document.createElement("div")
    rear.className = "side rear"
    const face = item.move.card ? cardMarkup(item.move.card, { extra: "fill" }) : `<span class="card back fill"></span>`
    const back = `<span class="card back fill"></span>`
    front.innerHTML = endFace ? face : back
    rear.innerHTML = startFace ? face : back
    turn.append(front, rear)
    flyer.append(turn)
    const dx = from.left - item.dest.left
    const dy = from.top - item.dest.top
    const sx = Math.max(0.2, from.width / item.dest.width)
    const sy = Math.max(0.2, from.height / item.dest.height)
    flyer.style.left = `${item.dest.left}px`
    flyer.style.top = `${item.dest.top}px`
    flyer.style.width = `${item.dest.width}px`
    flyer.style.height = `${item.dest.height}px`
    flyer.style.zIndex = String(20 + index)
    flyer.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${item.bunch % 2 ? -7 : 6}deg)`
    const flip = startFace !== endFace
    if (flip) turn.style.transform = "rotateY(180deg)"
    document.body.appendChild(flyer)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flyer.style.transition = `transform ${duration}ms cubic-bezier(.22,.7,.2,1) ${delay}ms`
      flyer.style.transform = "translate(0px, 0px) scale(1) rotate(0deg)"
      if (flip) {
        turn.style.transition = `transform ${Math.round(duration * 0.62)}ms ease-in-out ${delay + Math.round(duration * 0.14)}ms`
        turn.style.transform = "rotateY(0deg)"
      }
    }))
  })
  if (!prepared.length) return Promise.resolve()
  return sleep(duration + maxDelay + 40).then(() => {
    if (token !== flightGen) return
    document.querySelectorAll(".flyer").forEach((node) => node.remove())
    document.querySelectorAll(".flying-target").forEach((node) => node.classList.remove("flying-target"))
  })
}

async function commit(action) {
  const before = cardPlaces(match)
  const layout = captureLayout()
  const result = apply(match, action)
  if (!result.ok) {
    ui.error = result.error
    render()
    return false
  }
  ui.error = ""
  resetSelection()
  const moves = movesBetween(before, cardPlaces(match), action)
  render()
  await animateMoves(moves, layout)
  if (ui.summarize) {
    ui.summarize = false
    ui.modal = "summary"
    render()
  }
  return true
}

function notePhase() {
  if (!match || match.phase === lastPhase) return
  if (match.phase === "handEnd" || match.phase === "matchEnd") ui.summarize = true
  lastPhase = match.phase
}

function render() {
  notePhase()
  const scroller = document.querySelector(".hand-scroll")
  if (scroller) ui.handScroll = scroller.scrollLeft
  document.body.classList.toggle("is-busy", ui.busy)
  app.innerHTML = (ui.screen === "table" && match ? tableHtml() : lobbyHtml()) + modalHtml()
  const next = document.querySelector(".hand-scroll")
  if (next) next.scrollLeft = ui.handScroll
}

function resetSelection() {
  ui.selected.clear()
  ui.staged = []
  ui.taking = false
  ui.focusRank = null
}

async function doAction(action) {
  if (ui.busy) return
  ui.busy = true
  let ok = false
  try {
    ok = await commit(action)
  } finally {
    ui.busy = false
    render()
  }
  if (ok) runAi()
}

function stageSelection() {
  const cards = selectedCards()
  const top = ui.taking ? match.discard.at(-1) : null
  const matches = !!(top && cards.some((card) => isNatural(card) && card.rank === top.rank))
  const parsed = describeMeld(matches ? [...cards, top] : cards, false, match.rules === "house")
  if (!parsed.ok) {
    ui.error = parsed.error
    render()
    return
  }
  if (ui.taking && discardInfo(match, 0).frozen && matches && cards.filter((card) => card.rank === top.rank).length < 2) {
    ui.error = "A frozen pile needs two natural cards from your hand."
    render()
    return
  }
  const duplicate = ui.staged.some((ids) => ids.some((id) => myHand().find((card) => card.id === id)?.rank === parsed.rank))
  if (duplicate) {
    ui.error = "That rank is already in the opening meld."
    render()
    return
  }
  ui.staged.push(cards.map((card) => card.id))
  ui.selected.clear()
  ui.error = ""
  render()
}

function clickPile() {
  if (match.turn !== 0 || match.phase !== "draw") {
    ui.error = "Wait for your turn."
    render()
    return
  }
  const info = discardInfo(match, 0)
  if (!info.canTake) {
    ui.error = info.reason
    render()
    return
  }
  if (info.mode === "layoff") {
    doAction({ type: "take", groups: [] })
    return
  }
  ui.taking = true
  ui.error = ""
  render()
}

function meldSelected() {
  const cards = selectedCards()
  if (!cards.length) {
    ui.error = "Select the cards you want to meld."
    render()
    return
  }
  const rank = layoffRank(cards)
  if (rank != null) {
    doAction({ type: "layoff", cardIds: cards.map((card) => card.id), rank })
    return
  }
  const parsed = describeMeld(cards, false, match.rules === "house")
  if (!parsed.ok) {
    ui.error = ui.focusRank == null && cards.every(isWild) ? "Tap the meld that should receive the wild card." : parsed.error
    render()
    return
  }
  doAction({ type: "meld", cardIds: cards.map((card) => card.id) })
}

function discardSelected() {
  if (ui.staged.length) {
    ui.error = "Open those melds, or clear them, before discarding."
    render()
    return
  }
  const cards = selectedCards()
  if (cards.length !== 1) {
    ui.error = "Select one card to discard."
    render()
    return
  }
  doAction({ type: "discard", cardId: cards[0].id })
}

function goOut() {
  const hand = myHand()
  const cards = selectedCards()
  if (!hand.length) return doAction({ type: "goOut", cardId: null })
  if (cards.length === 1) return doAction({ type: "goOut", cardId: cards[0].id })
  if (!cards.length && (hand.every(isBlackThree) || hand.length === 1)) {
    return doAction(hand.length === 1 ? { type: "discard", cardId: hand[0].id } : { type: "goOut", cardId: null })
  }
  ui.error = "Meld the rest of the hand, or select the one card you will discard."
  render()
}

async function startMatch(seed = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0 || 1) {
  if (ui.busy) return
  ui.busy = true
  match = createMatch({ opponents: ui.opponents, seed, rules: ui.rules })
  ui.screen = "table"
  ui.modal = null
  ui.error = ""
  ui.summarize = false
  lastPhase = null
  resetSelection()
  try {
    await commit({ type: "deal" })
  } finally {
    ui.busy = false
    render()
  }
  runAi()
}

async function runAi() {
  const aiTurn = () => match && (match.phase === "draw" || match.phase === "meld") && !match.players[match.turn].isHuman
  if (ui.busy || !aiTurn()) return
  ui.busy = true
  render()
  try {
    let guard = 0
    while (guard++ < 8 && match && (match.phase === "draw" || match.phase === "meld") && !match.players[match.turn].isHuman) {
      const plan = planTurn(match)
      if (!plan.ok || !plan.actions.length) {
        ui.error = plan.error || "The opponent could not finish the turn."
        break
      }
      for (const action of plan.actions) {
        await sleep(reduceMotion ? 16 : 60)
        if (!(await commit(action))) return
      }
    }
  } finally {
    ui.busy = false
    render()
  }
}

function onClick(event) {
  const node = event.target.closest("[data-act], [data-opponents], [data-rules]")
  if (!node || ui.busy) return
  if (node.dataset.opponents) {
    ui.opponents = Number(node.dataset.opponents)
    render()
    return
  }
  if (node.dataset.rules) {
    ui.rules = node.dataset.rules
    render()
    return
  }
  const act = node.dataset.act
  if (act === "speed") return
  if (act === "rules") return ((ui.modal = "rules"), render())
  if (act === "scores") return ((ui.modal = "scores"), render())
  if (act === "close") return ((ui.modal = null), render())
  if (act === "start" || act === "again") return startMatch()
  if (act === "lobby") {
    ui.screen = "lobby"
    ui.modal = null
    match = null
    render()
    return
  }
  if (!match) return
  if (act === "card") {
    const id = Number(node.dataset.id)
    if (ui.selected.has(id)) ui.selected.delete(id)
    else ui.selected.add(id)
    ui.error = ""
    render()
    return
  }
  if (act === "focus") {
    const rank = Number(node.dataset.rank)
    ui.focusRank = ui.focusRank === rank ? null : rank
    render()
    return
  }
  if (act === "unstage") {
    ui.staged.splice(Number(node.dataset.index), 1)
    render()
    return
  }
  if (act === "stock") return doAction({ type: "draw" })
  if (act === "pile") return clickPile()
  if (act === "cancel-take") {
    ui.taking = false
    ui.staged = []
    ui.selected.clear()
    render()
    return
  }
  if (act === "stage") return stageSelection()
  if (act === "take") return doAction({ type: "take", groups: ui.staged })
  if (act === "open") {
    const used = new Set(ui.staged.flat())
    const left = myHand().filter((card) => !used.has(card.id))
    const discardId = left.length === 1 && ui.selected.has(left[0].id) ? left[0].id : null
    return doAction({ type: "open", groups: ui.staged, discardId })
  }
  if (act === "clear") {
    ui.staged = []
    ui.selected.clear()
    render()
    return
  }
  if (act === "meld-btn") return meldSelected()
  if (act === "discard-btn") return discardSelected()
  if (act === "go") return goOut()
  if (act === "undo") return doAction({ type: "undo" })
  if (act === "decline") return doAction({ type: "decline" })
  if (act === "next") {
    ui.modal = null
    doAction({ type: "next" })
  }
}

function onSpeed(event) {
  const node = event.target.closest("[data-act=speed]")
  if (!node) return
  const value = Number(node.value)
  if (value < 1 || value > 5) return
  ui.speed = value
  try {
    localStorage.setItem("canasta-motion", String(value))
  } catch {
    /* the slider still works when storage is blocked */
  }
  node.setAttribute("aria-valuenow", String(value))
  document.querySelectorAll("[data-speed-label]").forEach((label) => {
    label.textContent = SPEED_NAMES[value - 1]
  })
}

app.addEventListener("click", onClick)
app.addEventListener("input", onSpeed)
render()
