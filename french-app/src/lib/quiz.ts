import type { ReviewEvent, Word, WordProgress } from '../types'
import { effectiveConfidence } from './confidence'

export type QuizMode = 'choice' | 'typing' | 'listening'
export type QuizScope = 'topic' | 'recent' | 'random'

export interface QuizQuestion {
  mode: QuizMode
  word: Word
  /** For choice: UK translations to pick from. For listening: French spellings. */
  options?: string[]
  /** Index of the correct option */
  answerIndex?: number
}

export const correctEvent: Record<QuizMode, ReviewEvent> = {
  choice: 'quiz-choice-correct',
  typing: 'quiz-typing-correct',
  listening: 'quiz-listening-correct',
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Pick quiz words, weighting low effective-confidence words higher
 * (each word's weight is 110 − effectiveConfidence).
 */
export function pickQuizWords(
  pool: Word[],
  progress: Record<string, WordProgress>,
  count: number,
  rng: () => number = Math.random,
  now: Date = new Date(),
): Word[] {
  const remaining = [...pool]
  const picked: Word[] = []
  while (picked.length < count && remaining.length > 0) {
    const weights = remaining.map((w) => 110 - effectiveConfidence(progress[w.id], now))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = rng() * total
    let idx = 0
    for (; idx < remaining.length - 1; idx++) {
      roll -= weights[idx]
      if (roll <= 0) break
    }
    picked.push(remaining.splice(idx, 1)[0])
  }
  return picked
}

/**
 * Build a question for a word. Distractors are sampled from the same topic
 * first, then from the rest of the dictionary.
 */
export function buildQuestion(
  mode: QuizMode,
  word: Word,
  allWords: Word[],
  rng: () => number = Math.random,
): QuizQuestion {
  if (mode === 'typing') return { mode, word }

  const others = allWords.filter((w) => w.id !== word.id)
  const sameTopic = shuffle(others.filter((w) => w.topic === word.topic), rng)
  const rest = shuffle(others.filter((w) => w.topic !== word.topic), rng)
  const distractorWords = [...sameTopic, ...rest].slice(0, 3)

  const label = (w: Word) => (mode === 'choice' ? w.uk[0] : w.fr)
  const options = shuffle([label(word), ...distractorWords.map(label)], rng)
  return { mode, word, options, answerIndex: options.indexOf(label(word)) }
}

/**
 * Check a typed French answer. Case-insensitive; diacritics, apostrophes,
 * hyphens and leading articles are optional.
 */
export function checkTypedAnswer(expected: string, actual: string): boolean {
  const base = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/-/g, ' ')
  const stripArticle = (s: string) => s.replace(/^(le |la |les |l |un |une |des )/, '')
  // An apostrophe may be typed as nothing ("sil") or a space ("s il") — accept both.
  const forms = (s: string): Set<string> => {
    const b = base(s)
    const joined = b.replace(/['’]/g, '').replace(/\s+/g, ' ').trim()
    const spaced = b.replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim()
    return new Set([joined, spaced, stripArticle(joined), stripArticle(spaced)])
  }
  if (!actual.trim()) return false
  const expectedForms = forms(expected)
  for (const f of forms(actual)) if (expectedForms.has(f)) return true
  return false
}

/** The 15 most recently added words — the "refresh recent" pool. */
export function recentWords(words: Word[], count = 15): Word[] {
  return [...words].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, count)
}
