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
  assert.deepEqual(readOptions(storage), { assist: false, foot: true, goOut: true })
  assert.deepEqual(writeOptions(storage, { assist: true }), { assist: true, foot: true, goOut: true })
  assert.deepEqual(readOptions(storage), { assist: true, foot: true, goOut: true })
  writeOptions(storage, { assist: false, foot: false, goOut: true })
  assert.equal(readOptions(storage).assist, false)
  assert.equal(readOptions(storage).foot, false)
  assert.equal(readOptions(storage).goOut, true)
  writeOptions(storage, { assist: true })
  assert.equal(readOptions(storage).assist, true)
  assert.equal(readOptions(storage).foot, false)
  storage.setItem("canasta-options", '{"assist":true}')
  const older = readOptions(storage)
  assert.equal(older.assist, true)
  assert.equal(older.foot, true)
  assert.equal(older.goOut, true)
})

test("broken options storage stays off", () => {
  const storage = memory()
  storage.setItem("canasta-options", "{")
  assert.deepEqual(readOptions(storage), { assist: false, foot: true, goOut: true })
  storage.setItem("canasta-options", "null")
  assert.deepEqual(readOptions(storage), { assist: false, foot: true, goOut: true })
  storage.setItem("canasta-options", "[]")
  assert.deepEqual(readOptions(storage), { assist: false, foot: true, goOut: true })
})
