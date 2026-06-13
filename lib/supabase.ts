import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import * as FileSystem from 'expo-file-system/legacy'
import { createClient } from '@supabase/supabase-js'

declare const __DEV__: boolean

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// ── Types ──────────────────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface LeaderboardEntry {
  rank: number
  username: string
  total_score: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export type ProfileRow = {
  username: string | null
  total_score: number
  level: number
  xp: number
  lives: number
  coins: number
  // Note: the DB has a profiles_updated_at BEFORE UPDATE trigger (confirmed via
  // information_schema.triggers). The column it maintains is not selected here
  // because nothing in the app reads it. Add to this type and the select query
  // below only after confirming the column name via information_schema.columns.
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, total_score, level, xp, lives, coins')
    .eq('id', userId)
    .single()
  if (error) {
    // PGRST116: query returned 0 rows — new user has no profile yet, not an error
    if (error.code === 'PGRST116') return null
    throw error
  }
  if (!data) return null
  // assertRpcObject rejects null, undefined, and arrays — consistent with the
  // shape checks applied to all other Supabase responses in this file.
  assertRpcObject('getProfile', data)
  return {
    username:    typeof data.username    === 'string' ? data.username    : null,
    total_score: typeof data.total_score === 'number' ? data.total_score : 0,
    level:       typeof data.level       === 'number' ? data.level       : 1,
    xp:          typeof data.xp          === 'number' ? data.xp          : 0,
    // Default to 0, not 3 — 3 was the old starting value before the schema
    // was updated to 12. A corrupt lives value should surface as 0 (visibly
    // wrong) rather than 3 (silently plausible).
    lives:       typeof data.lives       === 'number' ? data.lives       : 0,
    coins:       typeof data.coins       === 'number' ? data.coins       : 0,
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// Shared shape guard for all RPC calls that return OUT parameters as a plain
// object. Extracted so:
//   1. The typeof-null === 'object' and typeof-[] === 'object' pitfalls are
//      handled exactly once with explicit case discrimination.
//   2. Error messages never include the raw response value, only a shape label
//      that cannot contain coin balances, scores, or other user data.
//
// Callers should rely on TypeScript's `asserts` narrowing after this call —
// do NOT follow it with `data as Record<string, unknown>` (that is a forced
// cast that bypasses the narrowing and loses type safety).
function assertRpcObject(rpcName: string, data: unknown): asserts data is Record<string, unknown> {
  if (
    data === null      ||
    data === undefined ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    // Each branch is explicit — typeof alone gives 'object' for null and array,
    // and 'function'/'symbol' for the final fallback (not just primitives).
    const shape = data === null       ? 'null'
                : data === undefined  ? 'undefined'
                : Array.isArray(data) ? 'array'
                : typeof data
    throw new Error(`${rpcName}: unexpected RPC response shape — received ${shape}`)
  }
}

// ── Spend Coins ────────────────────────────────────────────────────────────────

export type SpendCoinsResult = {
  coins: number
  lives: number
}

export async function spendCoins(
  userId: string,
  amount: number,     // renamed from 'cost' — matches p_amount in the RPC call
  heartsToAdd: number,
  itemName: string,
): Promise<SpendCoinsResult> {
  if (!userId)
    throw new Error('spendCoins: userId is required')
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error(`spendCoins: amount must be a positive integer, got ${amount}`)
  // Mirror the SQL guard exactly — p_hearts must be between 1 and 12.
  if (!Number.isInteger(heartsToAdd) || heartsToAdd <= 0 || heartsToAdd > MAX_LIVES)
    throw new Error(`spendCoins: heartsToAdd must be between 1 and ${MAX_LIVES}, got ${heartsToAdd}`)
  const trimmedItem = itemName.trim()
  if (!trimmedItem)
    throw new Error('spendCoins: itemName must not be empty')

  const { data, error } = await supabase.rpc('spend_coins', {
    p_user_id: userId,
    p_amount:  amount,
    p_hearts:  heartsToAdd,
    p_item:    trimmedItem,
  })
  if (error) throw error

  // spend_coins uses OUT parameters, which PostgREST returns as a single
  // plain object — not an array.
  assertRpcObject('spendCoins', data)
  // `data` is now Record<string, unknown> via the asserts predicate — no `as` cast needed.

  if (typeof data.out_coins !== 'number' || typeof data.out_lives !== 'number') {
    throw new Error(
      `spendCoins: RPC response missing out_coins or out_lives — got keys=[${Object.keys(data).join(', ')}]`
    )
  }

  return { coins: data.out_coins, lives: data.out_lives }
}

// ── Hearts ─────────────────────────────────────────────────────────────────────

export const MAX_LIVES       = 12
export const LIVES_PER_QUIZ  = 3                       // hearts available per quiz session
export const REGEN_HOURS     = 6                       // hours per life regenerated — must match SQL
const        REGEN_MS        = REGEN_HOURS * 3_600_000 // private; derived from REGEN_HOURS

export type RegenLivesResult = {
  lives: number
  nextLifeAt: Date | null  // null when already at MAX_LIVES
}

// Called on quiz start. Applies any regenerated lives and returns current count.
export async function regenLives(userId: string): Promise<RegenLivesResult> {
  if (!userId) throw new Error('regenLives: userId is required')

  const { data, error } = await supabase.rpc('regen_lives', { p_user_id: userId })
  if (error) throw error

  assertRpcObject('regenLives', data)

  const lives = typeof data.out_lives === 'number' ? data.out_lives : 0
  const raw   = data.out_next_life_at
  let nextLifeAt: Date | null = null
  if (typeof raw === 'string' && raw.length > 0) {
    const d = new Date(raw)
    // new Date('invalid') returns an Invalid Date whose getTime() is NaN.
    // Treat those as null so downstream countdown math never produces NaN.
    if (!isNaN(d.getTime())) nextLifeAt = d
  }

  return { lives, nextLifeAt }
}

// Called on every wrong answer (fire-and-forget). Returns the new lives count.
export async function deductLife(userId: string): Promise<number> {
  if (!userId) throw new Error('deductLife: userId is required')

  const { data, error } = await supabase.rpc('deduct_life', { p_user_id: userId })
  if (error) throw error

  assertRpcObject('deductLife', data)

  if (typeof data.out_lives !== 'number') {
    throw new Error(`deductLife: missing out_lives — got keys=[${Object.keys(data).join(', ')}]`)
  }
  return data.out_lives
}

// ── Guest hearts (local, mirrors DB mechanic) ──────────────────────────────────
// Guests get the same heart pool and regen rules as signed-in users.
// Write-through cache: sync reads from memory, fire-and-forget async writes to
// expo-file-system (Expo Go compatible, persists across restarts).
//
// Cache starts at MAX_LIVES so early reads before initGuestHearts() resolves
// always return a valid value (worst case: one session with wrong count if the
// user navigates into a quiz within ~50ms of launch).

interface GuestHeartsData {
  lives: number
  last_life_lost_at: string | null
}

function _freshGuestHearts(): GuestHeartsData {
  return { lives: MAX_LIVES, last_life_lost_at: null }
}

// Pre-initialised to a valid state — eliminates the null-before-init race.
let _guestHeartsCache: GuestHeartsData = _freshGuestHearts()

// Idempotent: second call returns the same in-flight promise.
let _initPromise: Promise<void> | null = null

// Cached once — documentDirectory is stable for the process lifetime.
// null means we're on web or the native bridge isn't ready; skip all file I/O.
let _heartsPathCache: string | null | undefined = undefined

function _heartsPath(): string | null {
  if (_heartsPathCache !== undefined) return _heartsPathCache
  const dir = FileSystem.documentDirectory  // string on RN, null on web
  _heartsPathCache = dir ? `${dir}guest-hearts.json` : null
  return _heartsPathCache
}

// Call once at app startup (e.g. in _layout.tsx) to rehydrate from disk.
// Safe to call multiple times — only runs once per process lifetime.
export function initGuestHearts(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = _doInitGuestHearts()
  return _initPromise
}

async function _doInitGuestHearts(): Promise<void> {
  const path = _heartsPath()
  if (!path) return // web — stay in-memory only
  try {
    // Single read — cheaper than getInfoAsync + readAsStringAsync.
    // Throws if the file doesn't exist; caught below (expected on first launch).
    const raw = await FileSystem.readAsStringAsync(path)

    // Cast to unknown first — the typeof guards below are the real type validation.
    const p = JSON.parse(raw) as unknown
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return

    const data = p as Record<string, unknown>

    const livesRaw = data.lives
    const lives = typeof livesRaw === 'number' && Number.isFinite(livesRaw)
      ? Math.max(0, Math.min(MAX_LIVES, Math.round(livesRaw)))
      : MAX_LIVES

    // Validate the date string is parseable — rejects "not-a-date" strings.
    const rawDate = data.last_life_lost_at
    const last_life_lost_at =
      typeof rawDate === 'string' && !isNaN(new Date(rawDate).getTime())
        ? rawDate
        : null

    _guestHeartsCache = { lives, last_life_lost_at }
  } catch {
    // File absent (first launch) or corrupt — cache stays at MAX_LIVES default.
    // Will be overwritten with real data on the next _writeGuestHearts call.
    if (__DEV__) console.warn('[GuestHearts] initGuestHearts: file missing or unreadable (normal on first launch)')
  }
}

// Returns a defensive copy — callers cannot accidentally mutate cached state.
function _readGuestHearts(): GuestHeartsData {
  return { lives: _guestHeartsCache.lives, last_life_lost_at: _guestHeartsCache.last_life_lost_at }
}

function _writeGuestHearts(data: GuestHeartsData): void {
  _guestHeartsCache = { lives: data.lives, last_life_lost_at: data.last_life_lost_at }
  const path = _heartsPath()
  if (!path) return // web — no file I/O
  FileSystem.writeAsStringAsync(path, JSON.stringify(_guestHeartsCache)).catch((e) => {
    if (__DEV__) console.warn('[GuestHearts] Write failed:', e)
  })
}

// Mirrors regen_lives SQL. Call on quiz start. Sync reads from in-memory cache.
export function regenLivesLocal(): RegenLivesResult {
  const { lives, last_life_lost_at } = _readGuestHearts()

  if (lives >= MAX_LIVES) {
    return { lives, nextLifeAt: null }
  }

  // Single timestamp snapshot — all time arithmetic in this call uses the same
  // moment so the stored anchor and returned nextLifeAt are never skewed.
  const nowMs = Date.now()
  const lastLost = last_life_lost_at === null ? null : new Date(last_life_lost_at)

  // No anchor or corrupt anchor — start the regen clock from now.
  if (lastLost === null || isNaN(lastLost.getTime())) {
    _writeGuestHearts({ lives, last_life_lost_at: new Date(nowMs).toISOString() })
    return { lives, nextLifeAt: new Date(nowMs + REGEN_MS) }
  }

  // Compute whole regen intervals elapsed directly against REGEN_MS — no
  // intermediate elapsedH float, no raw 3_600_000 literal.
  const toAdd = Math.min(
    Math.floor((nowMs - lastLost.getTime()) / REGEN_MS),
    MAX_LIVES - lives,
  )

  if (toAdd <= 0) {
    return { lives, nextLifeAt: new Date(lastLost.getTime() + REGEN_MS) }
  }

  const newLastLost = new Date(lastLost.getTime() + toAdd * REGEN_MS)
  const newLives    = lives + toAdd
  _writeGuestHearts({ lives: newLives, last_life_lost_at: newLastLost.toISOString() })

  return {
    lives:      newLives,
    nextLifeAt: newLives < MAX_LIVES ? new Date(newLastLost.getTime() + REGEN_MS) : null,
  }
}

// Mirrors deduct_life SQL. Call on wrong answer (fire-and-forget).
export function deductLifeLocal(): number {
  const data = _readGuestHearts()
  if (data.lives <= 0) return 0
  const newLives = data.lives - 1
  // The guard above ensures data.lives >= 1, so a life is always actually lost here.
  // Always record NOW — mirrors SQL: CASE WHEN lives > 0 THEN NOW() (always true post-guard).
  _writeGuestHearts({ lives: newLives, last_life_lost_at: new Date().toISOString() })
  return newLives
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_leaderboard')
  if (error) throw error
  if (!Array.isArray(data)) return []
  // flatMap: skip malformed rows rather than throwing, so a single bad row
  // doesn't crash the entire leaderboard. The cast below is validated —
  // null / non-object / array are all ruled out before it executes.
  return data.flatMap((row: unknown, i: number) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return []
    const r = row as Record<string, unknown>
    return [{
      rank:        typeof r.rank        === 'number' ? r.rank        : i + 1,
      username:    typeof r.username    === 'string' ? r.username    : 'Unknown',
      total_score: typeof r.total_score === 'number' ? r.total_score : 0,
    }]
  })
}

// ── Save Quiz Result ───────────────────────────────────────────────────────────

// Hard cap on score credited per quiz session.
// MUST match v_max_score in save_quiz_session (supabase/migrations/).
export const MAX_SCORE_PER_SESSION = 20_000

// XP required to advance one level. MUST match v_xp_per_level in save_quiz_session.
export const XP_PER_LEVEL = 500

// Values returned by save_quiz_session after a successful quiz save.
// The SQL function writes both quiz_sessions and profiles atomically, then
// returns the new totals so the client never needs a follow-up getProfile() call.
export type SaveQuizResultReturn = {
  totalScore:      number    // new cumulative total_score
  xp:              number    // new xp within the current level (already modulo'd)
  level:           number    // new level (may have increased)
  coins:           number    // new total coin balance
  coinsEarned:     number    // coins awarded for this session (for UI display)
  newlyUnlocked:   string[]  // achievement IDs unlocked this session (empty if none)
}

export async function saveQuizResult({
  userId,
  era,
  score,
  questionsAnswered,
  questionsCorrect,
  maxStreak = 0,
  perfect = false,
  livesRemaining = 0,
}: {
  userId: string
  era: string
  score: number
  questionsAnswered: number
  questionsCorrect: number
  maxStreak?: number
  perfect?: boolean
  livesRemaining?: number
}): Promise<SaveQuizResultReturn> {
  if (!userId) throw new Error('saveQuizResult: userId is required')
  if (!era) throw new Error('saveQuizResult: era is required')
  if (!Number.isFinite(score) || score < 0)
    throw new Error(`saveQuizResult: invalid score ${score}`)
  if (!Number.isInteger(questionsAnswered) || questionsAnswered < 1)
    throw new Error(`saveQuizResult: questionsAnswered must be a positive integer, got ${questionsAnswered}`)
  if (!Number.isInteger(questionsCorrect) || questionsCorrect < 0 || questionsCorrect > questionsAnswered)
    throw new Error(`saveQuizResult: questionsCorrect ${questionsCorrect} out of range [0, ${questionsAnswered}]`)

  const safeScore = Math.min(Math.trunc(score), MAX_SCORE_PER_SESSION)

  // Single RPC — INSERT quiz_sessions + UPDATE profiles happen in one SQL transaction.
  // Previously two separate network calls; a failure between them left an orphaned
  // session row with no profile credit. Now either both commit or neither does.
  const { data, error } = await supabase.rpc('save_quiz_session', {
    p_user_id:            userId,
    p_era:                era,
    p_score:              safeScore,
    p_questions_answered: questionsAnswered,
    p_questions_correct:  questionsCorrect,
    p_max_streak:         maxStreak,
    p_perfect:            perfect,
    p_lives_remaining:    livesRemaining,
  })
  if (error) throw error

  assertRpcObject('save_quiz_session', data)

  if (
    typeof data.out_total_score  !== 'number' ||
    typeof data.out_xp           !== 'number' ||
    typeof data.out_level        !== 'number' ||
    typeof data.out_coins        !== 'number' ||
    typeof data.out_coins_earned !== 'number'
  ) {
    throw new Error(
      `save_quiz_session: RPC response missing expected OUT fields — got keys=[${Object.keys(data).join(', ')}]`
    )
  }

  const newlyUnlocked = Array.isArray(data.out_newly_unlocked)
    ? (data.out_newly_unlocked as unknown[]).filter((id): id is string => typeof id === 'string')
    : []

  return {
    totalScore:    data.out_total_score,
    xp:            data.out_xp,
    level:         data.out_level,
    coins:         data.out_coins,
    coinsEarned:   data.out_coins_earned,
    newlyUnlocked,
  }
}

// ── Achievements ───────────────────────────────────────────────────────────────

export async function getUnlockedAchievements(userId: string): Promise<string[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId)
  if (error) throw error
  if (!Array.isArray(data)) return []
  return data.flatMap((row: unknown) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return []
    const r = row as Record<string, unknown>
    return typeof r.achievement_id === 'string' ? [r.achievement_id] : []
  })
}

// ── Profile Stats ──────────────────────────────────────────────────────────────

export interface ProfileStats {
  quizzesPlayed: number
  correctAnswers: number
  accuracy: number
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const zeros: ProfileStats = { quizzesPlayed: 0, correctAnswers: 0, accuracy: 0 }
  if (!userId) return zeros

  // Use the get_profile_stats RPC (see supabase/migrations/20260604_get_profile_stats.sql)
  // instead of fetching every session row and summing in JavaScript.
  // The old approach transferred O(n) rows for a user with n quiz sessions;
  // the RPC transfers a single aggregate row regardless of history size.
  const { data, error } = await supabase.rpc('get_profile_stats', {
    p_user_id: userId,
  })

  if (error) {
    if (__DEV__) console.error('[getProfileStats]', error)
    return zeros
  }

  assertRpcObject('getProfileStats', data)

  const quizzesPlayed   = typeof data.quizzes_played  === 'number' ? data.quizzes_played  : 0
  const correctAnswers  = typeof data.total_correct   === 'number' ? data.total_correct   : 0
  const totalAnswered   = typeof data.total_answered  === 'number' ? data.total_answered  : 0

  const safeCorrect  = Math.max(0, correctAnswers)
  const safeAnswered = Math.max(0, totalAnswered)
  const accuracy = safeAnswered > 0
    ? Math.min(100, Math.max(0, Math.round((safeCorrect / safeAnswered) * 100)))
    : 0

  return { quizzesPlayed: Math.max(0, quizzesPlayed), correctAnswers: safeCorrect, accuracy }
}