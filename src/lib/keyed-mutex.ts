/**
 * Keyed async mutex (D-064): serializes check-then-act sequences that share a
 * key (the collect endpoint's dedup find-then-create). Node runs one thread,
 * but awaits interleave concurrent requests — two identical beacons both ran
 * findFirst before either ran create (prod pair 09:39:50Z, same second).
 * Awaiting the previous holder's promise closes the race without a schema
 * change. Single-instance only (prod runs one); a second instance would need
 * a DB-level constraint instead.
 */
const chains = new Map<string, Promise<void>>()

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => mine)
  chains.set(key, tail)
  await prev
  try {
    return await fn()
  } finally {
    release()
    // Drop the entry only when no waiter chained behind us — deleting blindly
    // would orphan a waiter another holder already linked to.
    if (chains.get(key) === tail) chains.delete(key)
  }
}
