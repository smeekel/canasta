export const NAME_LIMIT = 24
const NAME_KEY = "canasta-name"
const SCORE_KEY = "canasta-scores"

export function readName(storage) {
  try {
    return String(storage.getItem(NAME_KEY) || "").slice(0, NAME_LIMIT)
  } catch {
    return ""
  }
}

export function writeName(storage, value) {
  const name = String(value ?? "").slice(0, NAME_LIMIT)
  try {
    storage.setItem(NAME_KEY, name)
  } catch {
    /* the field still works when storage is blocked */
  }
  return name
}

export function playingName(value) {
  const name = String(value ?? "").trim().slice(0, NAME_LIMIT)
  return name || "Anonymous"
}

export function normalizeScore(entry) {
  const score = Number(entry?.score)
  if (!entry || !Number.isFinite(score) || Math.abs(score) > 1000000) return null
  const name = String(entry.name || "Anonymous").trim().slice(0, NAME_LIMIT) || "Anonymous"
  const rules = entry.rules === "classic" ? "classic" : "house"
  const opponents = Math.min(3, Math.max(1, Number(entry.opponents) || 1))
  const when = typeof entry.when === "string" ? entry.when : ""
  return { name, score, rules, opponents, when }
}

export function finishedWhen(value) {
  if (!value) return ""
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return ""
  return `${when.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export function readScores(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(SCORE_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeScore).filter(Boolean).slice(0, 10)
  } catch {
    return []
  }
}

export const MIGRATED_KEY = "canasta-scores-migrated"
const OUTBOX_KEY = "canasta-score-outbox"

export function readOutbox(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(OUTBOX_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeScore).filter(Boolean).slice(0, 20)
  } catch {
    return []
  }
}

function writeOutbox(storage, scores) {
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(scores.slice(0, 20)))
  } catch {
    /* the server copy is the one that counts */
  }
}

export async function postScore(entry) {
  const response = await fetch("/api/scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  })
  if (!response.ok) throw new Error("The score was not saved.")
  return response.json()
}

export async function fetchScores() {
  const response = await fetch("/api/scores", { cache: "no-store" })
  if (!response.ok) throw new Error("Scores could not be loaded.")
  const body = await response.json()
  return Array.isArray(body.scores) ? body.scores.map(normalizeScore).filter(Boolean) : []
}

export async function migrateStoredScores(storage) {
  try {
    if (storage.getItem(MIGRATED_KEY) === "1") return
  } catch {
    return
  }
  const response = await fetch("/api/scores/migrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: readName(storage), scores: readScores(storage) }),
  })
  if (!response.ok) throw new Error("Saved scores could not be sent.")
  try {
    storage.setItem(MIGRATED_KEY, "1")
  } catch {
    /* a later load will try again */
  }
}

export async function flushOutbox(storage) {
  const pending = readOutbox(storage)
  if (!pending.length) return
  const left = []
  for (const entry of pending) {
    try {
      await postScore(entry)
    } catch {
      left.push(entry)
    }
  }
  writeOutbox(storage, left)
}

export function queueScore(storage, entry) {
  const next = normalizeScore(entry)
  if (!next) return
  writeOutbox(storage, [...readOutbox(storage), next])
}

export function recordScore(storage, entry) {
  const next = normalizeScore(entry)
  if (!next) return readScores(storage)
  const scores = readScores(storage)
  scores.push(next)
  scores.sort((a, b) => b.score - a.score || String(b.when).localeCompare(String(a.when)))
  const top = scores.slice(0, 10)
  try {
    storage.setItem(SCORE_KEY, JSON.stringify(top))
  } catch {
    /* keep the list for this page when storage is blocked */
  }
  return top
}

export function rankTotals(rows) {
  const sorted = rows.slice().sort((a, b) => b.total - a.total)
  let rank = 0
  let last = null
  return sorted.map((row, index) => {
    if (row.total !== last) {
      rank = index + 1
      last = row.total
    }
    return { ...row, rank, winner: rank === 1 }
  })
}
