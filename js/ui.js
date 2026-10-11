import { planTurn } from "./ai.js"
import {
  apply,
  canastaBreakdown,
  canastasNeeded,
  cardName,
  cardPoints,
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
  placementAllowed,
  rankLabel,
  sideName,
  sortHand,
  suitSymbol,
} from "./engine.js"
import { NAME_LIMIT, playingName, rankTotals, readName, readScores, recordScore, writeName } from "./scores.js"
import { built, repository, revision } from "./version.js"

const app = document.querySelector("#app")
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
const explain = {
  classic: {
    1: "Two-player Canasta. Fifteen cards each, draw two, and two canastas are required to go out.",
    2: "Three-player cutthroat. Thirteen cards each, and everyone scores alone.",
    3: "Classic four-handed partnerships. You play with Ellis, across the table, against Mina and Noah.",
  },
  house: {
    1: "You and Mina, each for yourself. Four hands, three decks, a hand and a foot, and one of each canasta to go out.",
    2: "You, Mina, and Ellis, each for yourself. Four hands, four decks, and nobody has a partner.",
    3: "Four players, each for yourself. Four hands and five decks. Partnerships are not used.",
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
  name: readName(localStorage),
  opponents: 3,
  selected: new Set(),
  staged: [],
  taking: false,
  focusRank: null,
  error: "",
  busy: false,
  modal: null,
  summarize: false,
  values: false,
  log: false,
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
  const noun = `red three${cards.length === 1 ? "" : "s"}`
  const label = `${cards.length} ${noun}: ${cards.map((card) => cardName(card)).join(", ")}`
  const faces = cards
    .slice(-4)
    .map((card) => cardMarkup(card, { small: true }))
    .join("")
  return `<div class="reds" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="red-stack">${faces}</span><span class="red-meta"><b>${cards.length}</b><span>Red ${cards.length === 1 ? "3" : "3s"}</span></span></div>`
}

function meldKind(meld) {
  if (meld.rank === 3 || meld.cards.length < 7) return ""
  if (meld.rank < 0) return "Wild canasta"
  if (meld.cards.some(isWild)) return "Mixed canasta"
  return "Pure canasta"
}

function meldView(meld, mine, pick) {
  const canasta = meld.cards.length >= 7 && meld.rank !== 3
  const mixed = canasta && meld.rank >= 0 && meld.cards.some(isWild)
  const wild = canasta && meld.rank < 0
  const classes = ["meld", canasta ? "canasta" : "", mixed ? "mixed" : "", wild ? "wild" : "", mine && ui.focusRank === meld.rank ? "on" : "", pick ? "pick" : ""]
    .filter(Boolean)
    .join(" ")
  const kind = meldKind(meld)
  const attrs = mine ? ` data-act="focus" data-rank="${meld.rank}"` : ""
  const title = kind ? ` title="${kind}"` : ""
  const cards = meld.cards.map((card) => cardMarkup(card, { small: true })).join("")
  const badge = `<span class="badge">${meld.cards.length}</span>`
  const add = pick ? `<button type="button" class="meld-add primary" data-act="add-wild" data-rank="${meld.rank}">Add</button>` : ""
  const anchor = `data-anchor="meld" data-rank="${meld.rank}"`
  return `<div class="${classes}"${attrs}${title} ${anchor}>${cards}${badge}${add}</div>`
}

function seatView(index) {
  const player = match.players[index]
  const active = match.turn === index && (match.phase === "draw" || match.phase === "meld")
  const partner = match.rules !== "house" && match.playerCount === 4 && index === 2
  const label = partner ? `${player.name} · partner` : player.name
  const foot = player.foot?.length ? ` · foot ${player.foot.length}` : ""
  return `<article class="seat${active ? " active" : ""}" data-anchor="seat-${index}">
    <div class="who"><strong>${esc(label)}</strong><span>${player.hand.length}${foot}</span></div>
    ${backs(player.hand.length)}
  </article>`
}

function meldZone(title, melds, reds, mine, anchor) {
  const picks = mine ? new Set(eligibleWildMelds(selectedCards()).map((meld) => meld.rank)) : new Set()
  const body = melds.length
    ? `<div class="melds">${melds.map((meld) => meldView(meld, mine, picks.has(meld.rank))).join("")}</div>`
    : `<p class="empty-note">No melds yet</p>`
  return `<section class="zone" data-anchor="${anchor}"><div class="meld-head"><span>${esc(title)}</span>${redMarks(reds)}</div>${body}</section>`
}

function opponentZones() {
  if (match.rules !== "house" && match.playerCount === 4) {
    const theirs = match.teams[1]
    return meldZone(sideName(match, 1), theirs.melds, theirs.redThrees, false, "zone-1")
  }
  return match.players
    .filter((player) => !player.isHuman)
    .map((player) => meldZone(player.name, match.teams[player.team].melds, match.teams[player.team].redThrees, false, `zone-${player.team}`))
    .join("")
}

function myZone() {
  const title = match.rules !== "house" && match.playerCount === 4 ? sideName(match, me().team) : "Your melds"
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
  const need = openingRequirement(myTeam().total, match)
  const note = myTeam().opened ? "" : ` <span>${points} / ${need}</span>`
  const ready = points >= need
  const open =
    ui.staged.length && !ui.taking
      ? pop(
          popButton("open", "Open", {
            primary: ready,
            disabled: !ready,
            title: ready ? "" : `${points} of ${need} points`,
          }),
          "pop-inline"
        )
      : ""
  return `<div class="stage"><div class="meld-head"><span>${ui.taking ? "Taking the discard" : "Opening meld"}${note}</span></div><div class="stage-row">${groups || "<p class=\"empty-note\">Select cards, then meld.</p>"}</div>${open}</div>`
}

function takeReady() {
  if (!ui.staged.length) return { ok: false, reason: "Add a meld that uses the discard." }
  const top = match.discard.at(-1)
  const usesTop = ui.staged.some((ids) =>
    ids.some((id) => {
      const card = myHand().find((item) => item.id === id)
      return card && isNatural(card) && card.rank === top?.rank
    })
  )
  if (!usesTop) return { ok: false, reason: "Add a meld that uses the discard." }
  if (!myTeam().opened) {
    const need = openingRequirement(myTeam().total, match)
    const points = stagedPoints(false)
    if (points < need) return { ok: false, reason: `${points} of ${need} points. Add more to the opening meld.` }
  }
  return { ok: true, reason: "" }
}

function stagedPoints(topAlreadyUsed = false) {
  const top = ui.taking ? match.discard.at(-1) : null
  let usedTop = topAlreadyUsed
  let points = 0
  for (const ids of ui.staged) {
    const group = ids.map((id) => myHand().find((card) => card.id === id)).filter(Boolean)
    const matches = top && !usedTop && group.some((card) => isNatural(card) && card.rank === top.rank)
    if (matches) usedTop = true
    points += group.reduce((sum, card) => sum + cardPoints(card), 0)
    if (matches) points += cardPoints(top)
  }
  return points
}

function runningLabel(cards) {
  const top = ui.taking ? match.discard.at(-1) : null
  const selectionUsesTop = !!(top && cards.some((card) => isNatural(card) && card.rank === top.rank))
  let total = cards.reduce((sum, card) => sum + cardPoints(card), 0)
  if (selectionUsesTop) total += cardPoints(top)
  total += stagedPoints(selectionUsesTop)
  if (!myTeam().opened && (cards.length > 1 || ui.staged.length)) {
    return `${total} / ${openingRequirement(myTeam().total, match)}`
  }
  return String(total)
}

function myTurn() {
  return match.turn === 0 && (match.phase === "draw" || match.phase === "meld")
}

function canUndo() {
  return match.turn === 0 && match.phase === "meld" && !!match.turnState?.snapshot
}

function canLeaveNow() {
  const team = myTeam()
  if (match.rules === "house") return meetsGoOut(match, team.melds) && !me().foot.length
  return countCanastas(team.melds) >= canastasNeeded(match)
}

function popButton(act, label, { primary = false, disabled = false, title = "", rank = null } = {}) {
  const tip = title ? ` title="${esc(title)}"` : ""
  const rankAttr = rank == null ? "" : ` data-rank="${rank}"`
  return `<button type="button" class="${primary ? "primary" : "ghost"}" data-act="${act}"${disabled ? " disabled" : ""}${tip}${rankAttr}>${esc(label)}</button>`
}

function pop(html, extra = "") {
  if (!html) return ""
  return `<div class="pop${extra ? ` ${extra}` : ""}">${html}</div>`
}

function stageCheck(cards) {
  const top = ui.taking ? match.discard.at(-1) : null
  const matches = !!(top && cards.some((card) => isNatural(card) && card.rank === top.rank))
  const parsed = describeMeld(matches ? [...cards, top] : cards, false, match.rules === "house")
  if (!parsed.ok) return parsed
  if (ui.taking && discardInfo(match, 0).frozen && matches && cards.filter((card) => card.rank === top.rank).length < 2) {
    return { ok: false, error: "A frozen pile needs two natural cards from your hand." }
  }
  const duplicate = ui.staged.some((ids) => ids.some((id) => myHand().find((card) => card.id === id)?.rank === parsed.rank))
  if (duplicate) return { ok: false, error: "That rank is already in the opening meld." }
  return { ok: true, error: "" }
}

function meldCheck(cards) {
  if (!myTeam().opened) return stageCheck(cards)
  if (layoffRank(cards) != null) return { ok: true, error: "" }
  const naturals = cards.filter(isNatural)
  if (
    naturals.length &&
    naturals.every((card) => card.rank === naturals[0].rank) &&
    myTeam().melds.some((meld) => meld.rank === naturals[0].rank && meld.cards.length < 7)
  ) {
    return { ok: false, error: "Add to the meld you already have. A new one starts after that canasta is complete." }
  }
  if (canLeaveNow() && cards.length === myHand().length && cards.every(isBlackThree)) {
    const blacks = describeMeld(cards, true)
    if (blacks.ok && blacks.black) return { ok: true, error: "", go: true }
  }
  const parsed = describeMeld(cards, false, match.rules === "house")
  return parsed.ok ? { ok: true, error: "" } : { ok: false, error: parsed.error || "" }
}

function handChoice(cards) {
  if (!myTurn()) return null
  if (ui.taking) {
    if (cards.length < 2) return null
    const check = stageCheck(cards)
    return { buttons: [{ act: "stage", label: "Meld", primary: check.ok, disabled: !check.ok, title: check.error }] }
  }
  if (match.phase !== "meld") return null
  if (cards.length === 1) {
    const blocked = ui.staged.length > 0
    const add = !blocked && myTeam().opened && layoffRank(cards) != null
    const wildAdd = blocked ? null : wildAddChoice(cards)
    const buttons = []
    if (add) buttons.push({ act: "meld-btn", label: "Add", primary: true })
    if (wildAdd) buttons.push(wildAdd)
    buttons.push({
      act: "discard-btn",
      label: "Discard",
      primary: !add && !wildAdd && !blocked,
      disabled: blocked,
      title: blocked ? "Open the staged melds before discarding." : "",
    })
    return { buttons }
  }
  if (cards.length > 1) {
    const check = meldCheck(cards)
    const adding = check.ok && !check.go && myTeam().opened && layoffRank(cards) != null
    const wildAdd = wildAddChoice(cards)
    const freshWild = newWildMeldChoice(cards)
    if (freshWild && adding) return { buttons: [freshWild, { act: "meld-btn", label: "Add" }] }
    if (wildAdd && !adding) return { buttons: [wildAdd] }
    const buttons = [
      {
        act: check.go ? "go" : myTeam().opened ? "meld-btn" : "stage",
        label: check.go ? "Go out" : adding ? "Add" : "Meld",
        primary: check.ok,
        disabled: !check.ok,
        title: check.error,
      },
    ]
    if (wildAdd) buttons.push(wildAdd)
    return { buttons }
  }
  return null
}

function piles() {
  const top = match.discard.at(-1)
  const freezer = freezeCard(match)
  const frozen = !!freezer
  const peek = freezer && freezer !== top ? cardMarkup(freezer, { small: true, extra: "peek" }) : ""
  const face = top ? cardMarkup(top, { extra: "show" }) : `<span class="card empty">Empty</span>`
  const info = discardInfo(match, 0)
  const drawing = myTurn() && match.phase === "draw" && !ui.taking && !match.mayDecline
  const declining = myTurn() && match.phase === "draw" && match.mayDecline && !ui.taking
  const stockOff = drawing ? "" : "disabled"
  const pileOff = myTurn() && match.phase === "draw" && !ui.taking ? "" : "disabled"
  let stockPop = ""
  if (drawing) stockPop = pop(popButton("stock", "Draw", { primary: true }))
  else if (declining) stockPop = pop(popButton("decline", "End hand", { primary: !info.canTake }))
  let discardPop = ""
  if (ui.taking && myTurn()) {
    const ready = takeReady()
    discardPop = pop(
      popButton("take", "Take pile", { primary: ready.ok, disabled: !ready.ok, title: ready.reason }) +
        popButton("cancel-take", "Cancel")
    )
  } else if (myTurn() && match.phase === "draw" && info.canTake) {
    discardPop = pop(popButton("pile", info.mode === "layoff" ? "Take discard" : "Take with cards", { primary: declining }))
  }
  return `<div class="piles">
    <div class="pile-slot stock"><button type="button" class="pile${drawing ? " ready" : ""}" data-act="stock" data-anchor="stock" ${stockOff}><span class="stack"><span class="card back"></span></span><span class="pile-meta"><b>${match.stock.length}</b>Stock</span></button>${stockPop}</div>
    <div class="pile-slot discard"><button type="button" class="pile${frozen ? " frozen" : ""}" data-act="pile" data-anchor="discard" ${pileOff} title="${esc(info.reason)}"><span class="stack">${peek}${face}</span><span class="pile-meta"><b>${match.discard.length}</b>${frozen ? "Frozen" : "Discard"}</span></button>${discardPop}</div>
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
  if (match.phase === "matchEnd") return "The game is over."
  const player = match.players[match.turn]
  if (!player.isHuman) return `${player.name} is playing…`
  if (myTurn() && (ui.taking || match.phase === "meld")) {
    const cards = selectedCards()
    if (match.phase === "meld" && cards.length && cards.every(isWild)) {
      const targets = eligibleWildMelds(cards)
      const aimed = layoffRank(cards)
      const wild = targets.some((meld) => meld.rank < 0)
      const natural = targets.some((meld) => meld.rank >= 0)
      if (newWildMeldChoice(cards) && natural) return "Meld the wild cards, or add them to the highlighted meld."
      if (wild && natural && (aimed == null || aimed >= 0)) {
        return "Add to the wild meld, or tap Add on another highlighted meld."
      }
      if (targets.length > 1) return "Add the wild card to one of the highlighted melds."
    }
    if (cards.length > 1) {
      const check = ui.taking || !myTeam().opened ? stageCheck(cards) : meldCheck(cards)
      if (!check.ok && check.error) return check.error
    }
  }
  if (ui.taking) {
    if (!myTeam().opened && ui.staged.length) {
      const need = openingRequirement(myTeam().total, match)
      const points = stagedPoints(false)
      if (points < need) return `Opening meld needs ${need} points. That selection is ${points}.`
    }
    return "Choose a natural pair that matches the discard. Add more melds if you still need points."
  }
  if (match.phase === "draw") {
    if (match.mayDecline) return "The stock is empty. Take the discard, or end the hand."
    const info = discardInfo(match, 0)
    const draw = match.rules === "house" ? "Draw two cards from the stock" : "Draw from the stock"
    return info.canTake ? `${draw}, or take the discard pile.` : `${draw}. ${info.reason}`
  }
  const team = myTeam()
  if (!team.opened) return `Your opening meld needs ${openingRequirement(team.total, match)} points. You can also discard without melding.`
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

function eligibleWildMelds(cards) {
  if (!myTurn() || match.phase !== "meld" || ui.staged.length) return []
  if (!cards.length || !cards.every(isWild) || !myTeam().opened) return []
  const house = match.rules === "house"
  const left = myHand().length - cards.length
  return myTeam().melds.filter((meld) => {
    if (meld.cards.length + cards.length > 7) return false
    if (!describeMeld([...meld.cards, ...cards], false, house).ok) return false
    const after = myTeam().melds.map((item) =>
      item === meld ? { rank: item.rank, cards: [...item.cards, ...cards] } : item
    )
    return placementAllowed(match, 0, left, after)
  })
}

function wildAddChoice(cards) {
  if (!cards.length || !cards.every(isWild)) return null
  const aimed = layoffRank(cards)
  if (aimed != null && aimed < 0) return null
  const wildTarget = eligibleWildMelds(cards).find((meld) => meld.rank < 0)
  if (!wildTarget) return null
  return { act: "add-wild", label: "Add to wilds", primary: aimed == null, rank: wildTarget.rank }
}

function newWildMeldChoice(cards) {
  if (!myTurn() || match.phase !== "meld" || ui.staged.length) return null
  if (match.rules !== "house" || !myTeam().opened) return null
  if (cards.length < 3 || !cards.every(isWild)) return null
  if (myTeam().melds.some((meld) => meld.rank < 0 && meld.cards.length < 7)) return null
  if (!describeMeld(cards, false, true).ok) return null
  const left = myHand().length - cards.length
  const after = myTeam().melds.concat([{ rank: -1, cards }])
  if (!placementAllowed(match, 0, left, after)) return null
  return { act: "wild-meld", label: "Meld", primary: true }
}

function layoffRank(cards) {
  if (cards.length && cards.every(isWild)) {
    const targets = eligibleWildMelds(cards)
    if (ui.focusRank != null && targets.some((meld) => meld.rank === ui.focusRank)) return ui.focusRank
    if (targets.length === 1) return targets[0].rank
    return null
  }
  const naturals = cards.filter(isNatural)
  if (naturals.length && naturals.some((card) => card.rank !== naturals[0].rank)) return null
  const rank = naturals.length ? naturals[0].rank : ui.focusRank
  if (rank == null) return null
  if (!cards.every((card) => isWild(card) || card.rank === rank)) return null
  const meld = myTeam().melds.find((item) => item.rank === rank && item.cards.length < 7)
  if (!meld || meld.cards.length + cards.length > 7) return null
  return rank
}

function rulesHtml() {
  const house = (match?.rules || ui.rules) === "house"
  const body = house
    ? `<p>House rules is four hands. Everyone scores alone, even with four players. The pack is one more deck than there are players, and each deck is 52 cards plus two jokers. Jokers and twos are wild.</p>
    <ul>
      <li>You are dealt 13 cards and a face-down foot of 13. Draw two cards, meld if you want, then discard one.</li>
      <li>Playing the last card of your hand picks up the foot. Discarding that card ends the turn. Melding it lets you continue.</li>
      <li>A pure canasta is seven cards of one rank and no wilds (500). A mixed canasta includes a wild (300). A wild canasta is seven wild cards (1,500). A finished canasta is frozen. You may start another of the same rank only after it is complete, so one unfinished meld of each rank is open at a time.</li>
      <li>To go out, have at least one of each canasta, then play every card in your hand and your foot. A hand also ends when the stock is used up. The highest score after four hands wins.</li>
      <li>The first meld must total 50 on the first hand, 90 on the second, 120 on the third, and 150 on the fourth.</li>
      <li>You may take the discard pile only when the top card starts a new meld. A card that matches an unfinished meld stays there. Once that canasta is complete, the same rank can start another meld. A frozen pile still needs a natural pair from your hand. Red threes score 100 each, or 200 each if you collect every red three in the pack.</li>
    </ul>`
    : `<p>A match is four hands. The highest score at the end wins. This is classic Canasta: two decks plus four jokers. Jokers and twos are wild. You meld sets, never sequences.</p>
    <ul>
      <li>With one opponent, draw two cards and make two canastas to go out. With two opponents, everyone plays alone. With three, you and Ellis are partners.</li>
      <li>On your turn, draw from the stock or take the whole discard pile, meld if you want, then discard one card.</li>
      <li>A meld needs at least two natural cards and at most three wild cards. A canasta is seven cards: 500 if it has no wilds, 300 if it does. A finished canasta is frozen, and another meld of that rank can be started once it is complete.</li>
      <li>Red threes are bonuses. They are tabled automatically. Four of them score 800, and they count against a side that never melds.</li>
      <li>The pile is frozen until your side opens, and whenever a wild card or red three is in it. A frozen pile can be taken only with a natural pair. A black three on top only blocks the next take.</li>
      <li>The first meld must total 15, 50, 90, or 120 points as your score rises. Going out scores 100, or 200 if you go out concealed on the same turn you first meld.</li>
    </ul>`
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="rules-title">
    <h2 id="rules-title">How to play</h2>
    ${body}
    <div class="actions">${match ? titleButton() : ""}<button type="button" class="primary" data-act="close">Back to the table</button></div>
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
    <div class="actions">${titleButton()}<button type="button" class="primary" data-act="close">Close</button></div>
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
  const nextOpen =
    match.rules === "house"
      ? `<p>The next hand opens at ${openingRequirement(0, { rules: "house", handNumber: hand.hand + 1 })}.</p>`
      : ""
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="sum-title">
    <h2 id="sum-title">Hand ${hand.hand} of 4</h2>
    <p>${reason}</p>
    ${nextOpen}
    ${lines}
    <div class="actions">${titleButton()}<button type="button" data-act="close">Look at the table</button><button type="button" class="primary" data-act="next">Next hand</button></div>
  </section></div>`
}

function titleButton() {
  return `<button type="button" data-act="title" title="Ends this game">Title</button>`
}

function crownMarkup() {
  return `<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 16.5 6.2 8.2 10 13.5 12 4.5l2 9 3.8-5.3 3.7 8.3z"/><path d="M4 18.2h16v2.3H4z"/></svg>`
}

function placeWord(rank) {
  const mod = rank % 100
  const suffix = mod >= 11 && mod <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[rank % 10] || "th"
  return `${rank}${suffix}`
}

function standings() {
  return rankTotals(match.teams.map((team, index) => ({ name: sideName(match, index), total: team.total })))
}

function winnerText() {
  const ranked = standings()
  const lead = ranked.filter((row) => row.winner)
  if (lead.length > 1) return "The match is a tie."
  const name = lead[0].name
  const verb = name === "You" || name === "Your side" || name.includes(" & ") ? "win" : "wins"
  const next = ranked.find((row) => !row.winner)
  const margin = next ? lead[0].total - next.total : lead[0].total
  return `${name} ${verb} by ${margin}.`
}

function finalHtml() {
  const rows = standings()
    .map(
      (row) =>
        `<li class="place${row.winner ? " first" : ""}"><span class="rank">${placeWord(row.rank)}</span><span class="who">${row.winner ? crownMarkup() : ""}<span>${esc(row.name)}</span></span><b>${row.total}</b></li>`
    )
    .join("")
  return `<div class="overlay"><section class="sheet final" role="dialog" aria-labelledby="final-title">
    <p class="eyebrow">Game over</p>
    <h2 id="final-title">Final standings</h2>
    <p class="final-lead">${esc(winnerText())} Four hands are complete.</p>
    <ol class="standings">${rows}</ol>
    <div class="actions"><button type="button" data-act="close">Look at the table</button>${titleButton()}<button type="button" class="primary" data-act="again">Play again</button></div>
  </section></div>`
}

function medalMarkup(place) {
  const kind = ["gold", "silver", "bronze"][place - 1]
  if (!kind) return `<span class="rank-num">${place}</span>`
  const label = ["Gold", "Silver", "Bronze"][place - 1]
  return `<svg class="medal ${kind}" viewBox="0 0 32 40" role="img" aria-label="${label}"><path class="ribbon left" d="M8 2h6l2 12H8z"/><path class="ribbon right" d="M18 2h6l-2 12h-8z"/><circle cx="16" cy="26" r="11"/><text x="16" y="30" text-anchor="middle">${place}</text></svg>`
}

function scoreMeta(entry) {
  const rules = entry.rules === "house" ? "House" : "Classic"
  const count = entry.opponents
  return `${rules} · ${count === 1 ? "1 opponent" : `${count} opponents`}`
}

function topScoresHtml() {
  const scores = readScores(localStorage)
  const rows = scores.length
    ? `<ol>${scores
        .map(
          (entry, index) =>
            `<li><span class="mark">${medalMarkup(index + 1)}</span><span class="who">${esc(entry.name)}<span class="meta">${esc(scoreMeta(entry))}</span></span><b>${entry.score}</b></li>`
        )
        .join("")}</ol>`
    : `<p class="empty-note">Finish a match to post a score.</p>`
  return `<section class="top-scores" aria-label="Top scores"><h2>Top scores</h2>${rows}</section>`
}

function nameField() {
  return `<label class="player-name"><span>Your name</span><input type="text" maxlength="${NAME_LIMIT}" placeholder="Optional" value="${esc(ui.name)}" data-act="name" autocomplete="nickname" aria-label="Your name, optional"></label>`
}

function lobbyHtml() {
  const choices = [1, 2, 3]
    .map((count) => `<button type="button" class="choice${ui.opponents === count ? " on" : ""}" data-opponents="${count}"><b>${count}</b><span>${count === 1 ? "opponent" : "opponents"}</span></button>`)
    .join("")
  const modes = [
    ["house", "House rules", "Solo, four hands"],
    ["classic", "Classic", "Four hands"],
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
    <p class="lede">${house ? "Four hands, a bigger pack, and a foot. You, and up to three opponents." : "Four hands on a green table. You, and up to three opponents."}</p>
    <div class="fan" aria-hidden="true">${sample.map((card) => cardMarkup(card)).join("")}</div>
    <div class="choices modes" role="group" aria-label="Rules">${modes}</div>
    <div class="choices" role="group" aria-label="Number of AI opponents">${choices}</div>
    <p class="explain">${esc(explain[ui.rules][ui.opponents])}</p>
    ${nameField()}
    ${speedControl()}
    <div class="lobby-actions">
      <button type="button" class="primary" data-act="start">Deal the first hand</button>
      <button type="button" class="ghost" data-act="rules">How to play</button>
    </div>
    ${versionButton()}
    ${topScoresHtml()}
  </section></main>`
}

function tableHtml() {
  const opponents = match.players.map((_, index) => index).filter((index) => index !== 0)
  const stagedIds = new Set(ui.staged.flat())
  const hand = sortHand(myHand().filter((card) => !stagedIds.has(card.id)))
  const yourTurn = myTurn()
  const chosen = hand.filter((card) => ui.selected.has(card.id))
  const choice = handChoice(chosen)
  const anchorId = chosen[0]?.id
  const total = choice && (match.phase === "meld" || ui.taking) ? runningLabel(chosen) : ""
  const cards = hand
    .map((card, index) => {
      const face = cardMarkup(card, { tag: "button", selected: ui.selected.has(card.id), attrs: `data-act="card" data-id="${card.id}"` })
      const chip = card.id === anchorId && total ? `<span class="points-chip">${esc(total)}</span>` : ""
      const buttons = choice ? choice.buttons.map((button) => popButton(button.act, button.label, button)).join("") : ""
      const bubble = card.id === anchorId && choice ? pop(`${chip}${buttons}`) : ""
      const beforeSel = ui.selected.has(hand[index + 1]?.id) ? " before-sel" : ""
      return `<div class="card-slot${beforeSel}">${bubble}${face}</div>`
    })
    .join("")
  const go =
    yourTurn && match.phase === "meld" && !hand.length && !ui.staged.length && canLeaveNow()
      ? pop(popButton("go", "Go out", { primary: true }), "pop-inline")
      : ""
  const finished =
    match.phase === "handEnd"
      ? pop(popButton("next", "Next hand", { primary: true }), "pop-inline")
      : match.phase === "matchEnd"
        ? pop(popButton("again", "Play again", { primary: true }), "pop-inline")
        : ""
  const foot = match.rules === "house" && me().foot.length ? `<div class="foot-row" data-anchor="foot">${backs(me().foot.length)}<span>Your foot · ${me().foot.length}</span></div>` : ""
  const openAt = match.rules === "house" && match.phase !== "matchEnd" ? openingRequirement(0, match) : null
  const dealLabel =
    match.phase === "matchEnd" ? "Game over" : openAt ? `Hand ${match.handNumber} of 4 · open ${openAt}` : `Hand ${match.handNumber} of 4`
  const undo = `<button type="button" class="undo" data-act="undo"${canUndo() ? "" : " disabled"}>Undo</button>`
  return `<main class="shell${yourTurn ? " your-turn" : ""}">
    <header class="topbar"><div class="brand"><span>${match.rules === "house" ? "House Canasta" : "Canasta"}</span>${versionButton()}</div><div class="top-actions"><button type="button" class="ghost" data-act="title" title="Ends this game">Title</button>${speedControl()}${undo}<button type="button" class="ghost" data-act="scores">Score</button><button type="button" class="ghost" data-act="log" aria-expanded="${ui.log}">Log</button><button type="button" class="ghost" data-act="values" aria-expanded="${ui.values}">Values</button><button type="button" class="ghost" data-act="rules">Rules</button></div></header>
    <div class="scoreline"><span${openAt ? ` title="Opening meld needs ${openAt} points"` : ""}>${dealLabel}</span>${finished}<span>${scoreText()}</span></div>
    <section class="seats">${opponents.map(seatView).join("")}</section>
    ${opponentZones()}
    ${piles()}
    ${myZone()}
    ${stagedPreview()}
    <p class="hint${ui.error ? " warn" : ""}" role="status">${esc(hint())}</p>
    ${foot}
    ${go}
    <div class="hand-scroll"><div class="hand${hand.length > 12 ? " tight" : ""}" data-anchor="hand">${cards}</div></div>
    ${valuesFlyout()}
    ${logFlyout()}
  </main>`
}

function logFlyout() {
  if (!ui.log) return ""
  const lines = match.log.length
    ? match.log.map((line) => `<li>${esc(line)}</li>`).join("")
    : `<li>No plays yet.</li>`
  return `<aside class="flyout log-flyout" role="dialog" aria-label="Play log">
    <div class="meld-head"><span>Play log</span><button type="button" class="x" data-act="log" aria-label="Close play log">×</button></div>
    <ul>${lines}</ul>
  </aside>`
}

function valuesFlyout() {
  if (!ui.values) return ""
  const rows = [
    ["Joker", cardPoints({ rank: 0, suit: "r" })],
    ["Ace, 2", cardPoints({ rank: 1, suit: "s" })],
    ["King through 8", cardPoints({ rank: 13, suit: "s" })],
    ["7 through 4, black 3", cardPoints({ rank: 7, suit: "s" })],
  ]
  return `<aside class="flyout" role="dialog" aria-label="Card values">
    <div class="meld-head"><span>Card values</span><button type="button" class="x" data-act="values" aria-label="Close card values">×</button></div>
    <ul>${rows.map(([name, value]) => `<li><span>${esc(name)}</span><b>${value}</b></li>`).join("")}</ul>
    <p>Red threes are bonuses, not meld points: 100 each, or 200 each when you collect every red three in the pack.</p>
  </aside>`
}

function versionWhen() {
  const when = new Date(built)
  if (Number.isNaN(when.getTime())) return built
  return `${when.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function versionButton() {
  return `<button type="button" class="version" data-act="about" title="About this build">${esc(revision)} · ${esc(versionWhen())}</button>`
}

function aboutHtml() {
  const commit = `${repository}/commit/${revision}`
  return `<div class="overlay"><section class="sheet" role="dialog" aria-labelledby="about-title">
    <h2 id="about-title">About</h2>
    <p>Canasta in the browser. This build is check-in <a href="${commit}" target="_blank" rel="noopener noreferrer">${esc(revision)}</a>, stamped <time datetime="${esc(built)}">${esc(versionWhen())}</time>.</p>
    <p>The check-in is the commit this page was built from. The time is when that stamp was written.</p>
    <p><a href="${repository}" target="_blank" rel="noopener noreferrer">Source on GitHub</a></p>
    <div class="actions">${match ? titleButton() : ""}<button type="button" class="primary" data-act="close">Close</button></div>
  </section></div>`
}

function modalHtml() {
  if (ui.modal === "about") return aboutHtml()
  if (ui.modal === "rules") return rulesHtml()
  if (ui.modal === "scores" && match) return match.phase === "matchEnd" ? finalHtml() : scoreHtml()
  if (ui.modal === "summary" && match?.handSummary) return match.phase === "matchEnd" ? finalHtml() : summaryHtml()
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
  const tight = el.querySelector(".stack > .card, .backs .card, .reds .card:last-child")
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
  const game = match
  if (!game || ui.screen !== "table") return false
  const before = cardPlaces(game)
  const layout = captureLayout()
  const result = apply(game, action)
  if (ui.screen !== "table" || match !== game) return false
  if (!result.ok) {
    ui.error = result.error
    render()
    return false
  }
  ui.error = ""
  resetSelection()
  const moves = movesBetween(before, cardPlaces(game), action)
  render()
  await animateMoves(moves, layout)
  if (ui.screen !== "table" || match !== game) return false
  if (ui.summarize) {
    ui.summarize = false
    ui.modal = "summary"
    render()
  }
  return true
}

function rememberScore() {
  if (!match || match.phase !== "matchEnd" || match.scorePosted) return
  if ((match.history || []).length < 4) return
  match.scorePosted = true
  const you = match.players.find((player) => player.isHuman)
  if (!you) return
  recordScore(localStorage, {
    name: you.name || "You",
    score: match.teams[you.team].total,
    rules: match.rules,
    opponents: match.playerCount - 1,
    when: new Date().toISOString(),
  })
}

function notePhase() {
  if (!match || match.phase === lastPhase) return
  if (match.phase === "handEnd" || match.phase === "matchEnd") ui.summarize = true
  if (match.phase === "matchEnd") rememberScore()
  lastPhase = match.phase
}

function leaveGame() {
  ui.screen = "lobby"
  ui.modal = null
  ui.values = false
  ui.log = false
  ui.error = ""
  ui.busy = false
  ui.summarize = false
  ui.taking = false
  lastPhase = null
  resetSelection()
  match = null
  render()
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
    if (match && ui.screen === "table") render()
  }
  if (ok && match && ui.screen === "table") runAi()
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

function meldWilds() {
  const cards = selectedCards()
  if (!newWildMeldChoice(cards)) {
    ui.error = "Those wild cards cannot start a meld."
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
  if (cards.length === hand.length && hand.every(isBlackThree)) return doAction({ type: "goOut", cardId: null })
  if (!cards.length && (hand.every(isBlackThree) || hand.length === 1)) {
    return doAction(hand.length === 1 ? { type: "discard", cardId: hand[0].id } : { type: "goOut", cardId: null })
  }
  ui.error = "Meld the rest of the hand, or select the one card you will discard."
  render()
}

async function startMatch(seed = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0 || 1) {
  if (ui.busy) return
  ui.busy = true
  const field = document.querySelector("[data-act=name]")
  if (field) ui.name = writeName(localStorage, field.value.slice(0, NAME_LIMIT))
  match = createMatch({ opponents: ui.opponents, seed, rules: ui.rules })
  const named = playingName(ui.name)
  if (named !== "You") match.players[0].name = named
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
    if (match && ui.screen === "table") render()
  }
}

function onClick(event) {
  const node = event.target.closest("[data-act], [data-opponents], [data-rules]")
  if (!node) return
  const act = node.dataset.act
  if (ui.busy && act !== "about" && act !== "close" && act !== "title") return
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
  if (act === "speed" || act === "name") return
  if (act === "values") {
    ui.values = !ui.values
    if (ui.values) ui.log = false
    render()
    return
  }
  if (act === "log") {
    ui.log = !ui.log
    if (ui.log) ui.values = false
    render()
    return
  }
  if (act === "about") return ((ui.modal = ui.modal === "about" ? null : "about"), (ui.values = false), (ui.log = false), render())
  if (act === "rules") return ((ui.modal = "rules"), (ui.values = false), (ui.log = false), render())
  if (act === "scores") return ((ui.modal = "scores"), render())
  if (act === "close") return ((ui.modal = null), render())
  if (act === "start" || act === "again") return startMatch()
  if (act === "title" || act === "lobby") return leaveGame()
  if (!match) return
  if (act === "card") {
    const id = Number(node.dataset.id)
    if (ui.selected.has(id)) ui.selected.delete(id)
    else ui.selected.add(id)
    ui.error = ""
    render()
    return
  }
  if (act === "add-wild") {
    const cards = selectedCards()
    const rank = Number(node.dataset.rank)
    if (!cards.length || !eligibleWildMelds(cards).some((meld) => meld.rank === rank)) {
      ui.error = "Select the wild cards, then choose a meld."
      render()
      return
    }
    ui.focusRank = rank
    return doAction({ type: "layoff", cardIds: cards.map((card) => card.id), rank })
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
  if (act === "wild-meld") return meldWilds()
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

function publishVersion() {
  const meta = document.querySelector('meta[name="version"]')
  if (meta) meta.content = `${revision} ${built}`
}

publishVersion()
function onName(event) {
  const node = event.target.closest("[data-act=name]")
  if (!node) return
  ui.name = writeName(localStorage, node.value.slice(0, NAME_LIMIT))
}

app.addEventListener("click", onClick)
app.addEventListener("input", onSpeed)
app.addEventListener("input", onName)
render()
