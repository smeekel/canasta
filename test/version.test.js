import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { built, repository, revision } from "../js/version.js"
import { readGitStamp, renderVersion, repositoryFromRemote } from "../script/version.mjs"
import { startServer } from "../script/serve.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))

test("version names a check-in and a build time", () => {
  assert.match(revision, /^[0-9a-f]{7,}$/)
  assert.equal(Number.isNaN(Date.parse(built)), false)
  assert.equal(repository, "https://github.com/smeekel/canasta")
})

test("a remote address keeps the repository and drops credentials", () => {
  assert.equal(repositoryFromRemote("https://github.com/smeekel/canasta.git"), "https://github.com/smeekel/canasta")
  assert.equal(repositoryFromRemote("git@github.com:smeekel/canasta.git"), "https://github.com/smeekel/canasta")
  assert.equal(
    repositoryFromRemote("https://x-access-token:ghs_secret@github.com/smeekel/canasta.git"),
    "https://github.com/smeekel/canasta"
  )
  assert.equal(repositoryFromRemote("https://example.com/other/repo.git"), "https://github.com/smeekel/canasta")
  assert.equal(repositoryFromRemote(""), "https://github.com/smeekel/canasta")
})

test("the stamp names the latest commit", () => {
  const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  const when = new Date(execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: root, encoding: "utf8" }).trim())
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
  const stamp = readGitStamp()
  assert.equal(stamp.revision, head)
  assert.equal(stamp.built, when)
  assert.equal(stamp.repository, "https://github.com/smeekel/canasta")
  assert.doesNotMatch(renderVersion(stamp), /ghs_|x-access-token/)
})

test("serving the site stamps the latest commit", async () => {
  const port = 8123
  const server = startServer(port)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/js/version.js`)
    assert.equal(response.status, 200)
    const text = await response.text()
    const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    assert.match(text, new RegExp(`export const revision = "${head}"`))
    assert.match(text, /export const built = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/)
    assert.doesNotMatch(text, /@/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
