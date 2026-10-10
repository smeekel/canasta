import assert from "node:assert/strict"
import test from "node:test"
import { built, repository, revision } from "../js/version.js"

test("version names a check-in and a build time", () => {
  assert.match(revision, /^[0-9a-f]{7,}$/)
  assert.equal(Number.isNaN(Date.parse(built)), false)
  assert.equal(repository, "https://github.com/smeekel/canasta")
})
