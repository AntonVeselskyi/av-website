#!/usr/bin/env node
// Zero-dependency validator for src/data/words.json.
// Used by the /add-word Claude skill and by the vitest seed test.
// Exits 1 with readable messages when the seed file is invalid.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DEFAULT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'words.json')

/** Normalize a French headword for duplicate detection: lowercase, strip articles and diacritics. */
export function normalizeFr(fr) {
  return fr
    .toLowerCase()
    .replace(/^(le |la |les |l'|un |une |des )/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’\s-]+/g, ' ')
    .trim()
}

/** Validate a parsed seed file object. Returns an array of error strings (empty = valid). */
export function validateSeed(seed) {
  const errors = []
  const err = (msg) => errors.push(msg)

  if (seed.version !== 1) err(`version must be 1, got ${JSON.stringify(seed.version)}`)
  if (!Array.isArray(seed.topics) || seed.topics.length === 0) {
    err('topics must be a non-empty array')
    return errors
  }
  if (!Array.isArray(seed.words)) {
    err('words must be an array')
    return errors
  }

  const topicIds = new Set()
  for (const t of seed.topics) {
    if (!t.id) err(`topic missing id: ${JSON.stringify(t)}`)
    if (topicIds.has(t.id)) err(`duplicate topic id "${t.id}"`)
    topicIds.add(t.id)
    for (const field of ['nameEn', 'nameUk', 'emoji', 'color']) {
      if (typeof t[field] !== 'string' || t[field].length === 0) err(`topic "${t.id}": missing ${field}`)
    }
    if (t.color && !/^#[0-9a-fA-F]{6}$/.test(t.color)) err(`topic "${t.id}": color must be #rrggbb, got "${t.color}"`)
  }

  const wordIds = new Set()
  const normalizedFrs = new Map()
  for (const w of seed.words) {
    const label = w.id || w.fr || JSON.stringify(w).slice(0, 40)
    if (typeof w.id !== 'string' || !/^[a-z0-9-]+$/.test(w.id)) {
      err(`word "${label}": id must be a lowercase ascii slug, got "${w.id}"`)
    }
    if (wordIds.has(w.id)) err(`duplicate word id "${w.id}"`)
    wordIds.add(w.id)

    if (typeof w.fr !== 'string' || w.fr.length === 0) err(`word "${label}": missing fr`)
    else {
      const norm = normalizeFr(w.fr)
      if (normalizedFrs.has(norm)) err(`word "${label}": duplicate French headword (same as "${normalizedFrs.get(norm)}")`)
      normalizedFrs.set(norm, w.fr)
    }

    for (const field of ['en', 'uk']) {
      if (!Array.isArray(w[field]) || w[field].length === 0 || w[field].some((s) => typeof s !== 'string' || !s)) {
        err(`word "${label}": ${field} must be a non-empty array of strings`)
      }
    }
    for (const field of ['ipa', 'cyr', 'topic', 'addedAt']) {
      if (typeof w[field] !== 'string' || w[field].length === 0) err(`word "${label}": missing ${field}`)
    }
    if (w.topic && !topicIds.has(w.topic)) err(`word "${label}": unknown topic "${w.topic}"`)
    if (w.addedAt && Number.isNaN(Date.parse(w.addedAt))) err(`word "${label}": addedAt "${w.addedAt}" is not a date`)

    if (!Array.isArray(w.examples) || w.examples.length < 1) {
      err(`word "${label}": examples must have at least 1 entry`)
    } else {
      w.examples.forEach((ex, i) => {
        for (const field of ['fr', 'en', 'uk', 'ipa', 'cyr']) {
          if (typeof ex[field] !== 'string' || ex[field].length === 0) {
            err(`word "${label}": example ${i + 1} missing ${field}`)
          }
        }
      })
    }
  }
  return errors
}

// CLI entry point: `node validate-words.mjs [path-to-words.json]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? DEFAULT_PATH
  let seed
  try {
    seed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`✗ ${path}: ${e.message}`)
    process.exit(1)
  }
  const errors = validateSeed(seed)
  if (errors.length > 0) {
    console.error(`✗ ${path}: ${errors.length} error(s)`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`✓ ${path}: ${seed.words.length} words across ${seed.topics.length} topics — valid`)
}
