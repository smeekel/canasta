const KEY = "canasta-options"

function defaults() {
  return { assist: false, foot: true, goOut: true }
}

export function readOptions(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults()
    return {
      assist: !!parsed.assist,
      foot: parsed.foot !== false,
      goOut: parsed.goOut !== false,
    }
  } catch {
    return defaults()
  }
}

export function writeOptions(storage, options) {
  const current = readOptions(storage)
  const saved = {
    assist: options && "assist" in options ? !!options.assist : current.assist,
    foot: options && "foot" in options ? options.foot !== false : current.foot,
    goOut: options && "goOut" in options ? options.goOut !== false : current.goOut,
  }
  try {
    storage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* the choice still applies for this visit */
  }
  return saved
}
