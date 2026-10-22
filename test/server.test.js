import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { MIGRATED_KEY, fetchScores, flushOutbox, migrateStoredScores, queueScore, readOutbox, recordScore } from "../js/scores.js"
import { addScore, openScores, storedScores, topScores } from "../script/db.mjs"
import { clientAddress, startServer } from "../server.mjs"

function memory() {
  const data = new Map()
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

async function listen(server) {
  if (server.listening) return
  await new Promise((resolve) => server.once("listening", resolve))
}

test("a finished game is stored with address and browser and the board stays public", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-scores-"))
  const dbPath = join(dir, "scores.sqlite")
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath })
  try {
    await listen(server)
    const port = server.address().port
    const posted = await fetch(`http://127.0.0.1:${port}/api/scores`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "CanastaTest/1.0" },
      body: JSON.stringify({ name: "Ada", score: 4200, rules: "house", opponents: 2, when: "2026-10-12T06:50:00.000Z" }),
    })
    assert.equal(posted.status, 201)
    const again = await fetch(`http://127.0.0.1:${port}/api/scores`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "CanastaTest/1.0" },
      body: JSON.stringify({ name: "Ada", score: 4200, rules: "house", opponents: 2, when: "2026-10-12T06:50:00.000Z" }),
    })
    assert.equal(again.status, 200)
    const listed = await fetch(`http://127.0.0.1:${port}/api/scores`)
    const body = await listed.json()
    assert.deepEqual(body.scores, [
      { name: "Ada", score: 4200, rules: "house", opponents: 2, when: "2026-10-12T06:50:00.000Z" },
    ])
    assert.equal(JSON.stringify(body).includes("127.0.0.1"), false)
    assert.equal(JSON.stringify(body).includes("CanastaTest"), false)
    const [row] = storedScores(server.db)
    assert.equal(row.ip, "127.0.0.1")
    assert.equal(row.browser, "CanastaTest/1.0")
    assert.equal(row.origin, "game")
    const profile = server.db.prepare("SELECT name, ip, browser FROM profiles").get()
    assert.equal(profile.name, "Ada")
    assert.equal(profile.ip, "127.0.0.1")
    const page = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /js\/ui\.js/)
    const hidden = await fetch(`http://127.0.0.1:${port}/data/scores.sqlite`)
    assert.equal(hidden.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    server.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the first visit sends saved browser scores once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-migrate-"))
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "scores.sqlite") })
  const storage = memory()
  const previous = globalThis.fetch
  try {
    await listen(server)
    const port = server.address().port
    globalThis.fetch = (url, options) => previous(new URL(url, `http://127.0.0.1:${port}`), options)
    recordScore(storage, { name: "Mina", score: 900, rules: "classic", opponents: 1, when: "2026-09-01T12:00:00.000Z" })
    recordScore(storage, { name: "Mina", score: 50, rules: "house", opponents: 3, when: "2026-09-02T12:00:00.000Z" })
    storage.setItem("canasta-name", "Mina")
    queueScore(storage, { name: "Ellis", score: 300, rules: "house", opponents: 2, when: "2026-09-03T12:00:00.000Z" })
    await migrateStoredScores(storage)
    await flushOutbox(storage)
    assert.equal(storage.getItem(MIGRATED_KEY), "1")
    assert.equal(readOutbox(storage).length, 0)
    await migrateStoredScores(storage)
    const board = topScores(server.db)
    assert.deepEqual(
      board.map((row) => row.name + row.score),
      ["Mina900", "Ellis300", "Mina50"]
    )
    const rows = storedScores(server.db)
    assert.equal(rows.filter((row) => row.origin === "browser").length, 2)
    assert.equal(rows.filter((row) => row.origin === "game").length, 1)
    assert.ok(rows.every((row) => row.ip === "127.0.0.1" && row.browser))
    const seen = await fetchScores()
    assert.equal(seen.length, 3)
    assert.equal(seen.some((row) => "ip" in row || "browser" in row), false)
  } finally {
    globalThis.fetch = previous
    await new Promise((resolve) => server.close(resolve))
    server.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a local proxy keeps the visitor address HAProxy forwarded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-proxy-"))
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "scores.sqlite") })
  try {
    await listen(server)
    const port = server.address().port
    const posted = await fetch(`http://127.0.0.1:${port}/api/scores`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "CanastaTest/1.0",
        "x-forwarded-for": "203.0.113.8, 198.51.100.22",
      },
      body: JSON.stringify({ name: "Ada", score: 1800, rules: "house", opponents: 1, when: "2026-10-22T20:00:00.000Z" }),
    })
    assert.equal(posted.status, 201)
    const [row] = storedScores(server.db)
    assert.equal(row.ip, "198.51.100.22")
    const listed = await fetch(`http://127.0.0.1:${port}/api/scores`)
    const body = await listed.json()
    assert.equal(JSON.stringify(body).includes("198.51.100.22"), false)
    assert.equal(server.db.prepare("SELECT ip FROM profiles").get().ip, "198.51.100.22")
  } finally {
    await new Promise((resolve) => server.close(resolve))
    server.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("only a loopback proxy may supply the visitor address", () => {
  assert.equal(clientAddress("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.10" }), "203.0.113.10")
  assert.equal(clientAddress("::1", { "x-real-ip": "[2001:db8::20]:443" }), "2001:db8::20")
  assert.equal(clientAddress("127.0.0.1", { "x-forwarded-for": "not-an-ip" }), "127.0.0.1")
  assert.equal(clientAddress("203.0.113.50", { "x-forwarded-for": "198.51.100.8" }), "203.0.113.50")
  assert.equal(clientAddress("::ffff:203.0.113.50", {}), "203.0.113.50")
})

test("only the ten highest scores are listed", () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-top-"))
  const db = openScores(join(dir, "scores.sqlite"))
  try {
    for (let score = 1; score <= 12; score++) {
      addScore(
        db,
        { name: "Ada", score, rules: "house", opponents: 1, when: `2026-01-${String(score).padStart(2, "0")}T00:00:00.000Z` },
        { ip: "203.0.113.4", browser: "Browser", origin: "game" }
      )
    }
    const board = topScores(db)
    assert.equal(board.length, 10)
    assert.equal(board[0].score, 12)
    assert.equal(board[9].score, 3)
    assert.equal(storedScores(db)[0].ip, "203.0.113.4")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
