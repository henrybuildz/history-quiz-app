// import-questions.mjs
// Usage:  node --env-file=.env import-questions.mjs
// Requires Node >= 20.6.0 (check: node --version)
// Requires EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import ws from 'ws'

// ── Env validation ────────────────────────────────────────────────────────────

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error([
    'ERROR: Missing environment variables.',
    'Make sure you are running: node --env-file=.env import-questions.mjs',
    'And that .env contains EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  ].join('\n'))
  process.exit(1)
}

// Verify service role key using correct base64url decoding with padding
try {
  const payloadBase64url = serviceRoleKey.split('.')[1]
  let base64 = payloadBase64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  if (payload.role !== 'service_role') {
    console.error('ERROR: The key provided is not a service role key. Check SUPABASE_SERVICE_ROLE_KEY in .env.')
    process.exit(1)
  }
} catch {
  console.error('ERROR: Could not decode the service role key. Make sure SUPABASE_SERVICE_ROLE_KEY is correct.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  realtime: { transport: ws }
})

// ── File loading ──────────────────────────────────────────────────────────────

const batchFiles = [
  './questions/batch1.json',
  './questions/batch2.json',
  './questions/batch3.json',
  './questions/batch4.json',
  './questions/batch5.json',
  './questions/batch6.json',
]

const allQuestions = []

for (const file of batchFiles) {
  if (!existsSync(file)) {
    console.error(`ERROR: File not found: ${file}`)
    process.exit(1)
  }

  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      console.error(`ERROR: ${file} does not contain a JSON array.`)
      process.exit(1)
    }

    parsed.forEach((q, localIndex) => {
      allQuestions.push({
        question_text: typeof q.question_text === 'string' ? q.question_text.trim() : q.question_text,
        correct_answer: typeof q.correct_answer === 'string' ? q.correct_answer.trim() : q.correct_answer,
        distractors: Array.isArray(q.distractors)
          ? q.distractors.map(d => typeof d === 'string' ? d.trim() : d)
          : q.distractors,
        explanation: q.explanation ?? null,
        era: typeof q.era === 'string' ? q.era.trim() : q.era,
        topic: q.topic ?? null,
        difficulty: q.difficulty,
        is_approved: q.is_approved ?? true,
        _sourceFile: file,
        _localIndex: localIndex,
      })
    })

    console.log(`Loaded ${parsed.length} questions from ${file}`)
  } catch (err) {
    console.error(`ERROR: Failed to parse ${file}: ${err.message}`)
    process.exit(1)
  }
}

console.log(`Total questions loaded: ${allQuestions.length}`)

// ── Validation ────────────────────────────────────────────────────────────────

const validationErrors = []

for (const q of allQuestions) {
  const loc = `${q._sourceFile} row ${q._localIndex}`

  if (typeof q.question_text !== 'string' || q.question_text.length <= 10) {
    validationErrors.push(`${loc}: question_text must be a string longer than 10 chars`)
  }
  if (typeof q.correct_answer !== 'string' || q.correct_answer.length === 0) {
    validationErrors.push(`${loc}: correct_answer missing or not a string`)
  }
  if (
    !Array.isArray(q.distractors) ||
    q.distractors.length !== 3 ||
    q.distractors.some(d => typeof d !== 'string' || d.length === 0)
  ) {
    validationErrors.push(`${loc}: distractors must be array of exactly 3 non-empty strings`)
  }
  if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 5) {
    validationErrors.push(`${loc}: difficulty must be a number between 1 and 5`)
  }
  if (typeof q.era !== 'string' || q.era.length === 0) {
    validationErrors.push(`${loc}: era missing or not a string`)
  }
}

if (validationErrors.length > 0) {
  console.error(`\nValidation failed with ${validationErrors.length} error(s):`)
  validationErrors.forEach(e => console.error('  -', e))
  process.exit(1)
}

console.log('All questions passed validation.')

// ── Duplicate detection ───────────────────────────────────────────────────────

const seen = new Set()
const dupes = []

for (const q of allQuestions) {
  const key = q.question_text.toLowerCase().replace(/\s+/g, ' ')
  if (seen.has(key)) {
    dupes.push(`${q._sourceFile} row ${q._localIndex}: "${q.question_text}"`)
  }
  seen.add(key)
}

if (dupes.length > 0) {
  console.error(`\nERROR: Found ${dupes.length} duplicate question(s):`)
  dupes.forEach(d => console.error('  -', d))
  process.exit(1)
}

// ── Strip internal tracking fields before insert ──────────────────────────────

const cleanQuestions = allQuestions.map(({ _sourceFile, _localIndex, ...q }) => q)

// ── Check database for existing questions ─────────────────────────────────────

const { count, error: countError } = await supabase
  .from('questions')
  .select('*', { count: 'exact', head: true })

if (countError) {
  console.error('ERROR: Could not check existing questions:', countError.message)
  console.error('Make sure you are using the service role key.')
  process.exit(1)
}

if (count > 0) {
  console.error([
    `\nERROR: The questions table already has ${count} rows.`,
    'To reimport, first clear the table in the Supabase SQL editor:',
    '  DELETE FROM questions;',
    'Then run this script again.',
  ].join('\n'))
  process.exit(1)
}

// ── Chunked insert ────────────────────────────────────────────────────────────

const CHUNK_SIZE = 100
const chunks = []
for (let i = 0; i < cleanQuestions.length; i += CHUNK_SIZE) {
  chunks.push(cleanQuestions.slice(i, i + CHUNK_SIZE))
}

console.log(`\nInserting ${cleanQuestions.length} questions in ${chunks.length} chunks...`)

let totalInserted = 0

for (let i = 0; i < chunks.length; i++) {
  const { error } = await supabase.from('questions').insert(chunks[i])

  if (error) {
    console.error(`\nERROR: Chunk ${i + 1}/${chunks.length} failed: ${error.message}`)
    console.error(`${totalInserted} questions inserted before failure. Clear the table and fix the error before retrying.`)
    process.exit(1)
  }

  totalInserted += chunks[i].length
  console.log(`  Chunk ${i + 1}/${chunks.length} done (${totalInserted}/${cleanQuestions.length})`)
}

console.log(`\nImport complete - ${totalInserted} questions inserted successfully.`)