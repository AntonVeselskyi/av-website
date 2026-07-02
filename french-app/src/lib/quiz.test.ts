import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import { buildQuestion, checkTypedAnswer, pickQuizWords, recentWords } from './quiz'
import { emptyProgress } from './confidence'

function word(id: string, topic: string, fr = id, uk = `укр-${id}`): Word {
  return {
    id,
    fr,
    en: [`en-${id}`],
    uk: [uk],
    ipa: '/x/',
    cyr: 'х',
    topic,
    examples: [{ fr: 'x', en: 'x', uk: 'х', ipa: '/x/', cyr: 'х' }],
    addedAt: '2026-07-01',
  }
}

const WORDS = [
  word('a', 't1'),
  word('b', 't1'),
  word('c', 't1'),
  word('d', 't1'),
  word('e', 't2'),
  word('f', 't2'),
]

describe('buildQuestion', () => {
  it('choice: has 4 unique options including the correct UK translation', () => {
    const q = buildQuestion('choice', WORDS[0], WORDS, () => 0.5)
    expect(q.options).toHaveLength(4)
    expect(new Set(q.options).size).toBe(4)
    expect(q.options![q.answerIndex!]).toBe(WORDS[0].uk[0])
  })

  it('choice: prefers distractors from the same topic', () => {
    const q = buildQuestion('choice', WORDS[0], WORDS, () => 0.5)
    const sameTopicUks = WORDS.filter((w) => w.topic === 't1' && w.id !== 'a').map((w) => w.uk[0])
    const distractors = q.options!.filter((o) => o !== WORDS[0].uk[0])
    expect(distractors.every((d) => sameTopicUks.includes(d))).toBe(true)
  })

  it('listening: options are French spellings', () => {
    const q = buildQuestion('listening', WORDS[0], WORDS, () => 0.5)
    expect(q.options![q.answerIndex!]).toBe(WORDS[0].fr)
  })

  it('typing: has no options', () => {
    const q = buildQuestion('typing', WORDS[0], WORDS)
    expect(q.options).toBeUndefined()
  })

  it('works with a pool smaller than 4', () => {
    const small = WORDS.slice(0, 2)
    const q = buildQuestion('choice', small[0], small, () => 0.5)
    expect(q.options!.length).toBe(2)
    expect(q.options![q.answerIndex!]).toBe(small[0].uk[0])
  })
})

describe('checkTypedAnswer', () => {
  it('accepts exact match', () => {
    expect(checkTypedAnswer('bonjour', 'bonjour')).toBe(true)
  })
  it('ignores case and diacritics', () => {
    expect(checkTypedAnswer('le café', 'LE CAFE')).toBe(true)
    expect(checkTypedAnswer('être', 'etre')).toBe(true)
    expect(checkTypedAnswer('la sœur', 'la soeur')).toBe(true)
  })
  it('treats apostrophes and hyphens as spaces', () => {
    expect(checkTypedAnswer("s'il vous plaît", 'sil vous plait')).toBe(true)
    expect(checkTypedAnswer('la grand-mère', 'la grand mere')).toBe(true)
  })
  it('allows dropping the article', () => {
    expect(checkTypedAnswer('le pain', 'pain')).toBe(true)
    expect(checkTypedAnswer("l'eau", 'eau')).toBe(true)
  })
  it('rejects wrong answers', () => {
    expect(checkTypedAnswer('bonjour', 'bonsoir')).toBe(false)
    expect(checkTypedAnswer('le pain', '')).toBe(false)
  })
})

describe('pickQuizWords', () => {
  it('returns the requested count without duplicates', () => {
    const picked = pickQuizWords(WORDS, {}, 4, () => 0.42)
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((w) => w.id)).size).toBe(4)
  })

  it('caps at pool size', () => {
    expect(pickQuizWords(WORDS, {}, 99, () => 0.42)).toHaveLength(WORDS.length)
  })

  it('prefers low-confidence words', () => {
    const progress = Object.fromEntries(
      WORDS.map((w) => [w.id, { ...emptyProgress(w.id), confidence: w.id === 'c' ? 0 : 100 }]),
    )
    // With a large sample, 'c' (weight 110) should be picked first far more
    // often than any single 100-confidence word (weight 10).
    let cFirst = 0
    let seed = 1
    const rng = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 200; i++) {
      if (pickQuizWords(WORDS, progress, 1, rng)[0].id === 'c') cFirst++
    }
    expect(cFirst).toBeGreaterThan(100)
  })
})

describe('recentWords', () => {
  it('sorts by addedAt descending and limits the count', () => {
    const words = [
      { ...word('old', 't1'), addedAt: '2026-01-01' },
      { ...word('new', 't1'), addedAt: '2026-07-01' },
      { ...word('mid', 't1'), addedAt: '2026-03-01' },
    ]
    expect(recentWords(words, 2).map((w) => w.id)).toEqual(['new', 'mid'])
  })
})
