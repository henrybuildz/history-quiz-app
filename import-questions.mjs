// import-questions.mjs
// Usage:  node --env-file=.env import-questions.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import ws from 'ws'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('ERROR: Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

try {
  const payloadBase64url = serviceRoleKey.split('.')[1]
  let base64 = payloadBase64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  if (payload.role !== 'service_role') {
    console.error('ERROR: Not a service role key.')
    process.exit(1)
  }
} catch {
  console.error('ERROR: Could not decode service role key.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  realtime: { transport: ws }
})

const questionsFolder = '/Users/henry/Library/Mobile Documents/com~apple~CloudDocs/Documents/Questions'

if (!existsSync(questionsFolder)) {
  console.error(`ERROR: Folder not found: ${questionsFolder}`)
  process.exit(1)
}

const files = readdirSync(questionsFolder)
  .filter(f => f.endsWith('.json'))
  .map(f => join(questionsFolder, f))

if (files.length === 0) {
  console.error('ERROR: No JSON files found.')
  process.exit(1)
}

console.log(`Found ${files.length} JSON files.`)

const allQuestions = []

for (const file of files) {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      console.error(`ERROR: ${file} is not a JSON array.`)
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

    console.log(`Loaded ${parsed.length} from ${file}`)
  } catch (err) {
    console.error(`ERROR: Failed to parse ${file}: ${err.message}`)
    process.exit(1)
  }
}

console.log(`Total loaded: ${allQuestions.length}`)

// ── Validation ────────────────────────────────────────────────────────────────

const validationErrors = []

for (const q of allQuestions) {
  const loc = `${q._sourceFile} row ${q._localIndex}`
  if (typeof q.question_text !== 'string' || q.question_text.length <= 10)
    validationErrors.push(`${loc}: question_text too short or not a string`)
  if (typeof q.correct_answer !== 'string' || q.correct_answer.length === 0)
    validationErrors.push(`${loc}: correct_answer missing`)
  if (!Array.isArray(q.distractors) || q.distractors.length !== 3 || q.distractors.some(d => typeof d !== 'string' || d.length === 0))
    validationErrors.push(`${loc}: distractors must be 3 non-empty strings`)
  if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 5)
    validationErrors.push(`${loc}: difficulty must be 1-5`)
  if (typeof q.era !== 'string' || q.era.length === 0)
    validationErrors.push(`${loc}: era missing`)
}

if (validationErrors.length > 0) {
  console.error(`\nValidation failed with ${validationErrors.length} error(s):`)
  validationErrors.forEach(e => console.error('  -', e))
  process.exit(1)
}

console.log('Validation passed.')

// ── Deduplicate within new batch ──────────────────────────────────────────────

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
  console.error(`\nFound ${dupes.length} duplicate(s) in new batch:`)
  dupes.forEach(d => console.error('  -', d))
  process.exit(1)
}

// ── Fetch existing question texts from DB to prevent re-insertion ─────────────

console.log('\nFetching existing questions from DB for duplicate check...')

const { data: existing, error: fetchError } = await supabase
  .from('questions')
  .select('question_text')

if (fetchError) {
  console.error('ERROR: Could not fetch existing questions:', fetchError.message)
  process.exit(1)
}

const existingKeys = new Set(
  (existing ?? []).map(q => q.question_text.toLowerCase().replace(/\s+/g, ' '))
)

const newQuestions = allQuestions.filter(q => {
  const key = q.question_text.toLowerCase().replace(/\s+/g, ' ')
  return !existingKeys.has(key)
})

const skipped = allQuestions.length - newQuestions.length
if (skipped > 0) {
  console.log(`Skipping ${skipped} questions already in DB.`)
}

if (newQuestions.length === 0) {
  console.log('No new questions to insert. All already exist in DB.')
  process.exit(0)
}

// ── Strip tracking fields ─────────────────────────────────────────────────────

const cleanQuestions = newQuestions.map(({ _sourceFile, _localIndex, ...q }) => q)

// ── Chunked insert ────────────────────────────────────────────────────────────

const CHUNK_SIZE = 100
const chunks = []
for (let i = 0; i < cleanQuestions.length; i += CHUNK_SIZE) {
  chunks.push(cleanQuestions.slice(i, i + CHUNK_SIZE))
}

console.log(`\nInserting ${cleanQuestions.length} new questions in ${chunks.length} chunks...`)

let totalInserted = 0

for (let i = 0; i < chunks.length; i++) {
  const { error } = await supabase.from('questions').insert(chunks[i])

  if (error) {
    console.error(`\nERROR: Chunk ${i + 1}/${chunks.length} failed: ${error.message}`)
    console.error(`${totalInserted} inserted before failure.`)
    process.exit(1)
  }

  totalInserted += chunks[i].length
  console.log(`  Chunk ${i + 1}/${chunks.length} done (${totalInserted}/${cleanQuestions.length})`)
}

console.log(`\nImport complete - ${totalInserted} questions inserted successfully.`)