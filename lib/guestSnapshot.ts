import * as FileSystem from 'expo-file-system/legacy'
import { MAX_LIVES } from './heartConstants'

export interface GuestSnapshotData {
  version: 1
  lives: number
  coins: number
  lastLifeLostAt: string | null
}

// Cached once — documentDirectory is stable for the process lifetime.
let _snapshotPathCache: string | null | undefined = undefined

function _snapshotPath(): string | null {
  if (_snapshotPathCache !== undefined) return _snapshotPathCache
  const dir = FileSystem.documentDirectory
  _snapshotPathCache = dir ? `${dir}guest-snapshot.json` : null
  return _snapshotPathCache
}

// In-memory cache: undefined = not yet read, null = confirmed absent, value = cached data.
// Invalidated by writeGuestSnapshot (new value) and clearGuestSnapshot (null).
// Eliminates repeated disk reads during a single guest session.
let _snapshotCache: GuestSnapshotData | null | undefined = undefined

export function writeGuestSnapshot({ lives, coins }: { lives: number; coins: number }): Promise<void> {
  const path = _snapshotPath()
  if (!path) return Promise.resolve()
  // lastLifeLostAt is intentionally null — the server-side regen anchor is not
  // included in ProfileRow and would require a schema change to capture at logout.
  // The guest regen clock restarts fresh after logout (see research.md Decision 6).
  const data: GuestSnapshotData = { version: 1, lives, coins, lastLifeLostAt: null }
  return FileSystem.writeAsStringAsync(path, JSON.stringify(data))
    .then(() => {
      // Update cache only after a confirmed write so cold-restart reads stay consistent.
      _snapshotCache = data
    })
}

export async function readGuestSnapshot(): Promise<GuestSnapshotData | null> {
  if (_snapshotCache !== undefined) return _snapshotCache
  const path = _snapshotPath()
  if (!path) { _snapshotCache = null; return null }
  try {
    const raw = await FileSystem.readAsStringAsync(path)
    const p = JSON.parse(raw) as unknown
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      _snapshotCache = null
      return null
    }

    const data = p as Record<string, unknown>

    if (data.version !== 1) { _snapshotCache = null; return null }

    const livesRaw = data.lives
    const lives = typeof livesRaw === 'number' && Number.isFinite(livesRaw)
      ? Math.max(0, Math.min(MAX_LIVES, Math.round(livesRaw)))
      : MAX_LIVES

    const coinsRaw = data.coins
    const coins = typeof coinsRaw === 'number' && Number.isFinite(coinsRaw) && coinsRaw >= 0
      ? Math.floor(coinsRaw)
      : 0

    const rawDate = data.lastLifeLostAt
    const lastLifeLostAt =
      typeof rawDate === 'string' && !isNaN(new Date(rawDate).getTime())
        ? rawDate
        : null

    _snapshotCache = { version: 1, lives, coins, lastLifeLostAt }
    return _snapshotCache
  } catch {
    _snapshotCache = null
    return null
  }
}

export function clearGuestSnapshot(): void {
  _snapshotCache = null
  const path = _snapshotPath()
  if (!path) return
  FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
}
