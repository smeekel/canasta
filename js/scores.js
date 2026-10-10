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
  return name || "You"
}

function cleanScore(entry) {
  if (!entry || typeof entry.score !== "number" || !Number.isFinite(entry.score)) return null
  const name = String(entry.name || "You").trim().slice(0, NAME_LIMIT) || "You"
  const rules = entry.rules === "classic" ? "classic" : "house"
  const opponents = Math.min(3, Math.max(1, Number(entry.opponents) || 1))
  const when = typeof entry.when === "string" ? entry.when : ""
  return { name, score: entry.score, rules, opponents, when }
}

export function readScores(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(SCORE_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.map(cleanScore).filter(Boolean).slice(0, 10)
  } catch {
    return []
  }
}

export function recordScore(storage, entry) {
  const next = cleanScore(entry)
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
