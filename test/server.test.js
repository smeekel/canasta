import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { fetchScores, flushOutbox, queueScore, readOutbox } from "../js/scores.js"
import { addScore, gamesPlayed, openScores, scoreRevision, storedScores, topScores, topScoresAll, topScoresMine } from "../script/db.mjs"
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
    assert.equal(body.played, 1)
    assert.equal(JSON.stringify(body).includes("127.0.0.1"), false)
    assert.equal(JSON.stringify(body).includes("CanastaTest"), false)
    const [row] = storedScores(server.db)
    assert.equal(row.ip, "127.0.0.1")
    assert.equal(row.browser, "CanastaTest/1.0")
    assert.equal(row.origin, "game")
    assert.equal(row.version, scoreRevision)
    assert.equal(body.version, scoreRevision)
    assert.deepEqual(body.all, body.scores)
    assert.deepEqual(body.mine, [])
    const named = await fetch(`http://127.0.0.1:${port}/api/scores?name=${encodeURIComponent(" Ada ")}`)
    assert.deepEqual((await named.json()).mine, body.scores)
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

test("a score that failed to post is sent on the next visit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-outbox-"))
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "scores.sqlite") })
  const storage = memory()
  const previous = globalThis.fetch
  try {
    await listen(server)
    const port = server.address().port
    globalThis.fetch = (url, options) => previous(new URL(url, `http://127.0.0.1:${port}`), options)
    queueScore(storage, { name: "Ellis", score: 300, rules: "house", opponents: 2, when: "2026-09-03T12:00:00.000Z" })
    await flushOutbox(storage)
    assert.equal(readOutbox(storage).length, 0)
    const board = topScores(server.db)
    assert.deepEqual(board.map((row) => row.name + row.score), ["Ellis300"])
    const [row] = storedScores(server.db)
    assert.equal(row.origin, "game")
    assert.equal(row.ip, "127.0.0.1")
    const seen = await fetchScores()
    assert.equal(seen.scores.some((entry) => "ip" in entry || "browser" in entry), false)
    assert.equal(seen.played, 1)
    const gone = await fetch(`http://127.0.0.1:${port}/api/scores/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    assert.equal(gone.status, 404)
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

test("the games played count is every score stored, past the ten on the board", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-played-"))
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "scores.sqlite") })
  const previous = globalThis.fetch
  try {
    await listen(server)
    const port = server.address().port
    globalThis.fetch = (url, options) => previous(new URL(url, `http://127.0.0.1:${port}`), options)
    for (let score = 1; score <= 12; score++) {
      const posted = await fetch(`http://127.0.0.1:${port}/api/scores`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada",
          score,
          rules: "house",
          opponents: 1,
          when: `2026-02-${String(score).padStart(2, "0")}T00:00:00.000Z`,
        }),
      })
      assert.equal(posted.status, 201)
    }
    const listed = await fetch(`http://127.0.0.1:${port}/api/scores`)
    const body = await listed.json()
    assert.equal(body.scores.length, 10)
    assert.equal(body.played, 12)
    assert.equal(JSON.stringify(body).includes("127.0.0.1"), false)
    const seen = await fetchScores()
    assert.equal(seen.scores.length, 10)
    assert.equal(seen.played, 12)
    assert.equal(gamesPlayed(server.db), 12)
  } finally {
    globalThis.fetch = previous
    await new Promise((resolve) => server.close(resolve))
    server.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
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
    assert.equal(gamesPlayed(db), 12)
    assert.equal(storedScores(db)[0].ip, "203.0.113.4")
    assert.equal(storedScores(db)[0].version, scoreRevision)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("startup adds a version column and leaves older scores off the current board", () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-migrate-"))
  const file = join(dir, "scores.sqlite")
  const raw = new DatabaseSync(file)
  raw.exec(`
    CREATE TABLE scores (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      rules TEXT NOT NULL,
      opponents INTEGER NOT NULL,
      finished_at TEXT NOT NULL,
      ip TEXT NOT NULL,
      browser TEXT NOT NULL,
      origin TEXT NOT NULL,
      UNIQUE (name, score, rules, opponents, finished_at)
    )
  `)
  raw
    .prepare(
      `INSERT INTO scores (name, score, rules, opponents, finished_at, ip, browser, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("Ada", 900, "house", 1, "2026-01-01T00:00:00.000Z", "203.0.113.9", "OldBrowser/1", "game")
  raw.close()
  const db = openScores(file)
  try {
    const names = db.prepare("PRAGMA table_info(scores)").all().map((column) => column.name)
    assert.equal(names.includes("version"), true)
    assert.equal(storedScores(db)[0].version, "")
    assert.equal(topScores(db).length, 0)
    assert.equal(topScoresAll(db)[0].score, 900)
    assert.equal(topScoresMine(db, "Ada")[0].name, "Ada")
    assert.equal(topScoresMine(db, " Ada ")[0].name, "Ada")
    assert.equal(topScoresMine(db, "Bea").length, 0)
    assert.equal(gamesPlayed(db), 1)
    addScore(db, { name: "Bea", score: 100, rules: "house", opponents: 1, when: "2026-11-01T00:00:00.000Z" }, { ip: "198.51.100.4", browser: "New/1" })
    assert.deepEqual(topScores(db).map((row) => row.name), ["Bea"])
    assert.deepEqual(topScoresAll(db).map((row) => row.name), ["Ada", "Bea"])
    assert.equal(gamesPlayed(db), 2)
    db.close()
    const again = openScores(file)
    assert.equal(again.prepare("SELECT COUNT(*) AS played FROM scores").get().played, 2)
    again.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("each score board is a different top ten and yours filters by name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canasta-boards-"))
  const server = startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "scores.sqlite") })
  const previous = globalThis.fetch
  try {
    await listen(server)
    const port = server.address().port
    globalThis.fetch = (url, options) => previous(new URL(url, `http://127.0.0.1:${port}`), options)
    const post = (name, score, agent) =>
      fetch(`http://127.0.0.1:${port}/api/scores`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": agent },
        body: JSON.stringify({ name, score, rules: "house", opponents: 1, when: `2026-11-02T00:00:${String(score).padStart(2, "0")}.000Z` }),
      })
    assert.equal((await post("Ada", 500, "Phone/1")).status, 201)
    assert.equal((await post("Ada", 250, "Laptop/2")).status, 201)
    assert.equal((await post("Bea", 800, "Laptop/2")).status, 201)
    server.db.prepare("UPDATE scores SET version = '' WHERE score = ?").run(500)
    const listed = await fetch(`http://127.0.0.1:${port}/api/scores?name=Ada`)
    const body = await listed.json()
    assert.deepEqual(body.scores.map((row) => row.name), ["Bea", "Ada"])
    assert.deepEqual(body.all.map((row) => row.name + row.score), ["Bea800", "Ada500", "Ada250"])
    assert.deepEqual(body.mine.map((row) => row.score), [500, 250])
    assert.equal(body.played, 3)
    assert.equal(body.version, scoreRevision)
    assert.equal(JSON.stringify(body).includes("127.0.0.1"), false)
    assert.equal(JSON.stringify(body).includes("Phone/1"), false)
    const other = await fetch(`http://127.0.0.1:${port}/api/scores?name=Bea`)
    const theirs = await other.json()
    assert.deepEqual(theirs.mine.map((row) => row.name), ["Bea"])
    assert.deepEqual(theirs.scores.map((row) => row.name), ["Bea", "Ada"])
    const seen = await fetchScores("Ada")
    assert.equal(seen.version, scoreRevision)
    assert.equal(seen.played, 3)
    assert.deepEqual(seen.mine.map((row) => row.score), [500, 250])
    assert.deepEqual(seen.all.map((row) => row.name), ["Bea", "Ada", "Ada"])
  } finally {
    globalThis.fetch = previous
    await new Promise((resolve) => server.close(resolve))
    server.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
