import assert from "node:assert/strict"
import test from "node:test"
import { readOptions, writeOptions } from "../js/options.js"

function memory() {
  const data = new Map()
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

test("player assist is remembered in browser storage", () => {
  const storage = memory()
  assert.deepEqual(readOptions(storage), { assist: false })
  assert.deepEqual(writeOptions(storage, { assist: true }), { assist: true })
  assert.deepEqual(readOptions(storage), { assist: true })
  writeOptions(storage, { assist: false })
  assert.equal(readOptions(storage).assist, false)
  assert.equal(storage.getItem("canasta-options"), '{"assist":false}')
})

test("broken options storage stays off", () => {
  const storage = memory()
  storage.setItem("canasta-options", "{")
  assert.deepEqual(readOptions(storage), { assist: false })
  storage.setItem("canasta-options", "null")
  assert.deepEqual(readOptions(storage), { assist: false })
  storage.setItem("canasta-options", "[]")
  assert.deepEqual(readOptions(storage), { assist: false })
})
