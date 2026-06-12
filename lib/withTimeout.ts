/**
 * Races `promise` against a deadline and always resolves — never rejects.
 * Use when you want to wait for an async operation before proceeding but
 * must not block indefinitely on a network drop (e.g. awaiting a DB save
 * before navigating home from the quiz results screen).
 *
 * The `settled` flag guarantees `resolve` is called exactly once even when
 * the timeout fires first and the promise later settles.
 */
export function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const id = setTimeout(settle, ms)
    promise.then(
      () => { clearTimeout(id); settle() },
      () => { clearTimeout(id); settle() },
    )
  })
}
