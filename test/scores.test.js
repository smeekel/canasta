import assert from "node:assert/strict"
import test from "node:test"
import { playingName, rankTotals, readName, readScores, recordScore, writeName } from "../js/scores.js"

function memory() {
  const data = new Map()
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

test("a name is optional and comes back from storage", () => {
  const storage = memory()
  assert.equal(readName(storage), "")
  assert.equal(playingName("  "), "You")
  assert.equal(playingName(" Ada "), "Ada")
  writeName(storage, "Ada")
  assert.equal(readName(storage), "Ada")
  writeName(storage, "x".repeat(40))
  assert.equal(readName(storage).length, 24)
})

test("only the top ten finished scores are kept", () => {
  const storage = memory()
  for (let score = 1; score <= 12; score++) {
    recordScore(storage, { name: "Ada", score, rules: "house", opponents: 2, when: `2026-01-${String(score).padStart(2, "0")}` })
  }
  const scores = readScores(storage)
  assert.equal(scores.length, 10)
  assert.equal(scores[0].score, 12)
  assert.equal(scores[9].score, 3)
  assert.equal(scores.some((entry) => entry.score === 1), false)
  assert.equal(scores[0].rules, "house")
})

test("standings rank ties and mark every winner", () => {
  const ranked = rankTotals([
    { name: "Mina", total: 100 },
    { name: "Ada", total: 250 },
    { name: "Ellis", total: 250 },
    { name: "Noah", total: 40 },
  ])
  assert.deepEqual(
    ranked.map((row) => [row.name, row.rank, row.winner, row.total]),
    [
      ["Ada", 1, true, 250],
      ["Ellis", 1, true, 250],
      ["Mina", 3, false, 100],
      ["Noah", 4, false, 40],
    ]
  )
})
