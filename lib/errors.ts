// Supabase PostgrestError does not extend Error, so `err instanceof Error`
// is false for any DB client call that throws. Use this everywhere a Supabase
// operation can fail instead of `err.message`.
//
// Always extracts — the caller decides what to display and when. Do not add
// __DEV__ gating here; display policy belongs at the call site, not in a
// generic utility.
export function extractErrorMessage(err: unknown, fallback: string): string {
  // Guard against new Error('') — an empty message is no better than no message.
  if (err instanceof Error && err.message.length > 0) return err.message;

  // Thrown strings are bad practice but valid JS — handle them so they
  // aren't silently swallowed.
  if (typeof err === 'string' && err.length > 0) return err;

  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }

  return fallback;
}
