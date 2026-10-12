import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const FALLBACK_REPOSITORY = "https://github.com/smeekel/canasta"

export function repositoryFromRemote(remote) {
  const cleaned = String(remote || "")
    .replace(/:\/\/[^@\s]+@/, "://")
    .trim()
    .replace(/\.git$/, "")
  const ssh = cleaned.match(/^git@github\.com:([^/\s]+\/[^/\s]+)$/)
  if (ssh) return `https://github.com/${ssh[1]}`
  const https = cleaned.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)$/)
  if (https) return `https://github.com/${https[1]}`
  return FALLBACK_REPOSITORY
}

export function renderVersion({ revision, built, repository }) {
  return `// Written from the current commit by script/version.mjs.\nexport const revision = ${JSON.stringify(revision)}\nexport const built = ${JSON.stringify(built)}\nexport const repository = ${JSON.stringify(repository)}\n`
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

export function readGitStamp() {
  const revision = git(["rev-parse", "--short=7", "HEAD"])
  const built = new Date(git(["log", "-1", "--format=%cI"])).toISOString().replace(/\.\d{3}Z$/, "Z")
  if (!/^[0-9a-f]{7,}$/.test(revision) || Number.isNaN(Date.parse(built))) {
    throw new Error("The current commit could not be read.")
  }
  let remote = ""
  try {
    remote = git(["remote", "get-url", "origin"])
  } catch {
    remote = ""
  }
  return { revision, built, repository: repositoryFromRemote(remote) }
}

export function versionSource() {
  return renderVersion(readGitStamp())
}

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  return fileURLToPath(import.meta.url) === fileURLToPath(new URL(entry, `file://${process.cwd()}/`))
}

if (invokedDirectly()) {
  const file = fileURLToPath(new URL("../js/version.js", import.meta.url))
  writeFileSync(file, versionSource())
}
