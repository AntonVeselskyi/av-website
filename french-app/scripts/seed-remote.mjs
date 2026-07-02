#!/usr/bin/env node
// Push the local seed words to the deployed AWS backend.
// Usage: node scripts/seed-remote.mjs https://xxxx.execute-api.eu-central-1.amazonaws.com <api-key>

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const [apiUrl, apiKey] = process.argv.slice(2)
if (!apiUrl || !apiKey) {
  console.error('Usage: node scripts/seed-remote.mjs <API_URL> <API_KEY>')
  process.exit(1)
}

const seedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'words.json')
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))

const res = await fetch(`${apiUrl.replace(/\/$/, '')}/seed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify({ words: seed.words }),
})

if (!res.ok) {
  console.error(`✗ seeding failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`✓ seeded ${seed.words.length} words to ${apiUrl}`)
