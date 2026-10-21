import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { addScore, openScores, rememberProfile, topScores } from "./script/db.mjs"

const root = fileURLToPath(new URL(".", import.meta.url)).replace(new RegExp(`${sep === "\\" ? "\\\\" : sep}$`), "") || sep
const defaultDb = join(root, "data", "canasta.sqlite")
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
}

function clientIp(request) {
  const address = request.socket?.remoteAddress || ""
  return address.replace(/^::ffff:/, "").slice(0, 80)
}

function clientBrowser(request) {
  return String(request.headers["user-agent"] || "").slice(0, 300)
}

function fileFor(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html"
  if (rel === "data" || rel.startsWith("data/") || rel.startsWith("data\\")) return null
  const file = normalize(join(root, rel.endsWith("/") ? `${rel}index.html` : rel))
  if (file !== root && !file.startsWith(root + sep)) return null
  return file
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 65536) throw new Error("too large")
    chunks.push(chunk)
  }
  if (!size) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function startServer({ port = 8080, host = "127.0.0.1", dbPath = defaultDb } = {}) {
  const db = openScores(dbPath)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1")
    const ip = clientIp(request)
    const browser = clientBrowser(request)
    try {
      if (url.pathname === "/api/scores" && request.method === "GET") {
        sendJson(response, 200, { scores: topScores(db) })
        return
      }
      if (url.pathname === "/api/scores" && request.method === "POST") {
        const body = await readJson(request)
        const saved = addScore(db, body, { ip, browser, origin: "game" })
        rememberProfile(db, { name: body.name, ip, browser })
        sendJson(response, saved ? 201 : 200, { ok: true, saved })
        return
      }
      if (url.pathname === "/api/scores/migrate" && request.method === "POST") {
        const body = await readJson(request)
        const scores = Array.isArray(body.scores) ? body.scores.slice(0, 20) : []
        let saved = 0
        for (const entry of scores) saved += addScore(db, entry, { ip, browser, origin: "browser" }) ? 1 : 0
        rememberProfile(db, { name: body.name, ip, browser })
        sendJson(response, 200, { ok: true, saved })
        return
      }
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { ok: false })
        return
      }
    } catch {
      sendJson(response, 400, { ok: false })
      return
    }
    let file
    try {
      file = fileFor(url.pathname)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    if (!file) {
      response.writeHead(403)
      response.end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end("Not found")
    }
  })
  server.db = db
  server.listen(port, host)
  return server
}

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  return fileURLToPath(import.meta.url) === fileURLToPath(new URL(entry, `file://${process.cwd()}/`))
}

if (invokedDirectly()) {
  const port = Number(process.env.PORT || 8080)
  const host = process.env.HOST || "0.0.0.0"
  startServer({ port, host, dbPath: process.env.SCORES_DB || defaultDb })
  const shown = host === "0.0.0.0" ? "127.0.0.1" : host
  console.log(`http://${shown}:${port}/`)
}
