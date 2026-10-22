const KEY = "canasta-options"

export function readOptions(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "{}")
    if (!parsed || typeof parsed !== "object") return { assist: false }
    return { assist: !!parsed.assist }
  } catch {
    return { assist: false }
  }
}

export function writeOptions(storage, options) {
  const saved = { assist: !!(options && options.assist) }
  try {
    storage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* the choice still applies for this visit */
  }
  return saved
}
