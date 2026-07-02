// Guards the real seed file: the same checks the /add-word skill runs.
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs script shared with the skill, no type declarations
import { validateSeed } from '../scripts/validate-words.mjs'
import seed from './data/words.json'

describe('words.json seed', () => {
  it('passes the validator', () => {
    const errors = validateSeed(seed) as string[]
    expect(errors).toEqual([])
  })

  it('has a meaningful amount of starter vocabulary', () => {
    expect(seed.topics.length).toBeGreaterThanOrEqual(10)
    expect(seed.words.length).toBeGreaterThanOrEqual(100)
  })
})
