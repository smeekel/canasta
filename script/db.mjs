import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { normalizeScore } from "../js/scores.js"

const SCORE_LIMIT = 1000000

export function openScores(file) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
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
    );
    CREATE TABLE IF NOT EXISTS profiles (
      ip TEXT NOT NULL,
      browser TEXT NOT NULL,
      name TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (ip, browser)
    );
  `)
  return db
}

export function rememberProfile(db, { name = "", ip = "", browser = "" } = {}) {
  const clean = String(name || "").trim().slice(0, 24)
  if (!clean) return
  db.prepare(
    `INSERT INTO profiles (ip, browser, name, seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ip, browser) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at`
  ).run(String(ip).slice(0, 80), String(browser).slice(0, 300), clean, new Date().toISOString())
}

function finishedAt(value) {
  const when = new Date(value || "")
  if (Number.isNaN(when.getTime())) return new Date().toISOString()
  return when.toISOString()
}

export function addScore(db, entry, { ip = "", browser = "", origin = "game" } = {}) {
  const clean = normalizeScore(entry)
  if (!clean || Math.abs(clean.score) > SCORE_LIMIT) return false
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO scores (name, score, rules, opponents, finished_at, ip, browser, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clean.name,
      Math.round(clean.score),
      clean.rules,
      clean.opponents,
      finishedAt(clean.when),
      String(ip).slice(0, 80),
      String(browser).slice(0, 300),
      origin === "browser" ? "browser" : "game"
    )
  return info.changes > 0
}

export function topScores(db, limit = 10) {
  return db
    .prepare(
      `SELECT name, score, rules, opponents, finished_at
       FROM scores
       ORDER BY score DESC, finished_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      name: row.name,
      score: row.score,
      rules: row.rules,
      opponents: row.opponents,
      when: row.finished_at,
    }))
}

export function storedScores(db) {
  return db.prepare("SELECT name, score, rules, opponents, finished_at, ip, browser, origin FROM scores ORDER BY id").all()
}
