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
  coins: number
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
  const d = data as Record<string, unknown>
  return {
    username:    typeof d.username    === 'string' ? d.username    : null,
    total_score: typeof d.total_score === 'number' ? d.total_score : 0,
    level:       typeof d.level       === 'number' ? d.level       : 1,
    xp:          typeof d.xp          === 'number' ? d.xp          : 0,
    // Default to 0, not 3 — 3 was the old starting value before the schema
    // was updated to 12. A corrupt lives value should surface as 0 (visibly
    // wrong) rather than 3 (silently plausible).
    lives:       typeof d.lives       === 'number' ? d.lives       : 0,
    coins:       typeof d.coins       === 'number' ? d.coins       : 0,
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
  if (!Number.isInteger(heartsToAdd) || heartsToAdd <= 0 || heartsToAdd > 12)
    throw new Error(`spendCoins: heartsToAdd must be between 1 and 12, got ${heartsToAdd}`)
  if (!itemName.trim())
    throw new Error('spendCoins: itemName must not be empty')

  const { data, error } = await supabase.rpc('spend_coins', {
    p_user_id: userId,
    p_amount:  amount,
    p_hearts:  heartsToAdd,
    p_item:    itemName,
  })
  if (error) throw error

  // spend_coins uses OUT parameters, which PostgREST returns as a single
  // plain object — not an array.
  if (
    data === null      ||
    data === undefined ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    throw new Error(
      `spendCoins: unexpected RPC response shape — got ${JSON.stringify(data)}`
    )
  }

  const d = data as Record<string, unknown>

  if (typeof d.out_coins !== 'number' || typeof d.out_lives !== 'number') {
    throw new Error(
      `spendCoins: RPC response missing out_coins or out_lives — got ${JSON.stringify(d)}`
    )
  }

  const coins: number = d.out_coins
  const lives: number = d.out_lives
  return { coins, lives }
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

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

// ── Save Quiz Result ───────────────────────────────────────────────────────────

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
  if (!userId) throw new Error('saveQuizResult: userId is required')
  if (!era) throw new Error('saveQuizResult: era is required')
  if (!Number.isFinite(score) || score < 0)
    throw new Error(`saveQuizResult: invalid score ${score}`)
  if (!Number.isInteger(questionsAnswered) || questionsAnswered < 1)
    throw new Error(`saveQuizResult: questionsAnswered must be a positive integer, got ${questionsAnswered}`)
  if (!Number.isInteger(questionsCorrect) || questionsCorrect < 0 || questionsCorrect > questionsAnswered)
    throw new Error(`saveQuizResult: questionsCorrect ${questionsCorrect} out of range [0, ${questionsAnswered}]`)

  const safeScore = Math.trunc(score)

  const { error: sessionError } = await supabase
    .from('quiz_sessions')
    .insert({
      user_id: userId,
      era,
      score: safeScore,
      questions_answered: questionsAnswered,
      questions_correct: questionsCorrect,
      completed: true,
    })
  if (sessionError) throw sessionError

  const { error: profileError } = await supabase.rpc('increment_user_score', {
    p_user_id: userId,
    p_score: safeScore,
  })
  if (profileError) throw profileError
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

  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('questions_correct, questions_answered')
    .eq('user_id', userId)
    .eq('completed', true)

  if (error) {
    console.error('getProfileStats error:', error)
    return zeros
  }
  if (!Array.isArray(data) || data.length === 0) return zeros

  let totalAnswered = 0
  let correctAnswers = 0
  for (const row of data) {
    const r = row as Record<string, unknown>
    correctAnswers += typeof r.questions_correct  === 'number' ? r.questions_correct  : 0
    totalAnswered  += typeof r.questions_answered === 'number' ? r.questions_answered : 0
  }

  const safeCorrect  = Math.max(0, correctAnswers)
  const safeAnswered = Math.max(0, totalAnswered)
  const accuracy = safeAnswered > 0
    ? Math.min(100, Math.max(0, Math.round((safeCorrect / safeAnswered) * 100)))
    : 0

  return { quizzesPlayed: data.length, correctAnswers: safeCorrect, accuracy }
}