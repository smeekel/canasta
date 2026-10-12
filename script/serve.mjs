import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { versionSource } from "./version.mjs"

const root = fileURLToPath(new URL("..", import.meta.url)).replace(new RegExp(`${sep === "\\" ? "\\\\" : sep}$`), "") || sep
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
}

function versionBody() {
  try {
    return versionSource()
  } catch {
    return readFileSync(join(root, "js", "version.js"))
  }
}

function fileFor(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html"
  const file = normalize(join(root, rel.endsWith("/") ? `${rel}index.html` : rel))
  if (file !== root && !file.startsWith(root + sep)) return null
  return file
}

export function startServer(port) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1")
    if (url.pathname === "/js/version.js") {
      response.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" })
      response.end(versionBody())
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
  }).listen(port, "127.0.0.1")
}

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  return fileURLToPath(import.meta.url) === fileURLToPath(new URL(entry, `file://${process.cwd()}/`))
}

if (invokedDirectly()) {
  const port = Number(process.env.PORT || 8080)
  startServer(port)
  console.log(`http://127.0.0.1:${port}/`)
}
