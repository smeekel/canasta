import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { finishedWhen, playingName, rankTotals, readName, readScores, recordScore, writeName } from "../js/scores.js"

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
  assert.equal(playingName("  "), "Anonymous")
  assert.equal(playingName(""), "Anonymous")
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

test("a finished score keeps the date and time", () => {
  const storage = memory()
  const when = "2026-10-12T06:50:00.000Z"
  recordScore(storage, { name: "Ada", score: 1200, rules: "house", opponents: 1, when })
  recordScore(storage, { name: "You", score: 400, rules: "classic", opponents: 3, when: "" })
  const scores = readScores(storage)
  assert.equal(scores[0].when, when)
  assert.match(finishedWhen(scores[0].when), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} /)
  assert.equal(finishedWhen(scores[1].when), "")
  assert.equal(finishedWhen("not-a-date"), "")
})

test("a score time is shown in the browser timezone", () => {
  const root = fileURLToPath(new URL("..", import.meta.url))
  for (const [zone, expected] of [
    ["UTC", "2026-10-12 06:50 UTC"],
    ["America/New_York", "2026-10-12 02:50 EDT"],
    ["America/Los_Angeles", "2026-10-11 23:50 PDT"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { finishedWhen } from "./js/scores.js"
const shown = finishedWhen("2026-10-12T06:50:00.000Z")
if (shown !== ${JSON.stringify(expected)}) {
  console.error(shown)
  process.exit(1)
}`],
      { cwd: root, env: { ...process.env, TZ: zone }, encoding: "utf8" }
    )
    assert.equal(result.status, 0, `${zone}: ${result.stderr || result.stdout}`)
  }
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
