import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'

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
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, total_score, level, xp, lives')
    .eq('id', userId)
    .single()
  if (error) {
    // PGRST116: query returned 0 rows — new user has no profile yet, not an error
    if (error.code === 'PGRST116') return null
    throw error
  }
  if (!data) return null
  // Defensive field validation — guards against schema drift and unexpected types,
  // consistent with the pattern used in getLeaderboard.
  const d = data as Record<string, unknown>
  return {
    username: typeof d.username === 'string' ? d.username : null,
    total_score: typeof d.total_score === 'number' ? d.total_score : 0,
    level: typeof d.level === 'number' ? d.level : 1,
    xp: typeof d.xp === 'number' ? d.xp : 0,
    lives: typeof d.lives === 'number' ? d.lives : 3,
  }
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_leaderboard')
  if (error) throw error
  if (!Array.isArray(data)) return []
  return data.map((row: unknown, i: number) => {
    const r = row as Record<string, unknown>
    return {
      rank: typeof r.rank === 'number' ? r.rank : i + 1,
      username: typeof r.username === 'string' ? r.username : 'Unknown',
      total_score: typeof r.total_score === 'number' ? r.total_score : 0,
    }
  })
}

export async function saveQuizResult({
  userId,
  era,
  score,
  questionsAnswered,
  questionsCorrect,
}: {
  userId: string
  era: string
  score: number
  questionsAnswered: number
  questionsCorrect: number
}) {
  // Runtime validation — TypeScript types are compile-time only. Garbage inputs
  // here produce orphaned DB rows or silent constraint violations.
  if (!userId) throw new Error('saveQuizResult: userId is required')
  if (!era) throw new Error('saveQuizResult: era is required')
  if (!Number.isFinite(score) || score < 0)
    throw new Error(`saveQuizResult: invalid score ${score}`)
  if (!Number.isInteger(questionsAnswered) || questionsAnswered < 1)
    throw new Error(`saveQuizResult: questionsAnswered must be a positive integer, got ${questionsAnswered}`)
  if (!Number.isInteger(questionsCorrect) || questionsCorrect < 0 || questionsCorrect > questionsAnswered)
    throw new Error(`saveQuizResult: questionsCorrect ${questionsCorrect} out of range [0, ${questionsAnswered}]`)

  // Math.trunc ensures no float ever reaches the DB even if score arithmetic drifts.
  const safeScore = Math.trunc(score)

  // NOT idempotent: calling this function twice for the same session inserts two
  // rows and fires increment_user_score twice, doubling the leaderboard score.
  // Any retry logic MUST be gated behind a unique constraint + ON CONFLICT at the
  // DB level before it is safe to call this more than once per quiz completion.
  //
  // NOTE: two separate round-trips — not atomic. If the RPC fails after the insert
  // the session row exists without a profile score update. The correct fix is a
  // single Postgres function that does both in one transaction (see increment_user_score
  // migration TODO). Do not reorder these two calls.
  const { error: sessionError } = await supabase
    .from('quiz_sessions')
    .insert({
      user_id: userId,
      era,
      score: safeScore,
      questions_answered: questionsAnswered,
      questions_correct: questionsCorrect,
      completed: true,
      // completed_at intentionally omitted — column DEFAULT now() is authoritative;
      // client-side timestamps are subject to device clock drift.
    })
  if (sessionError) throw sessionError

  const { error: profileError } = await supabase.rpc('increment_user_score', {
    p_user_id: userId,
    p_score: safeScore,
  })
  if (profileError) throw profileError
}
