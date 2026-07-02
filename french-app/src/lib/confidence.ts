import type { ReviewEvent, WordProgress } from '../types'

/** Confidence at or above this = "mastered" (drives achievements + learnedAt). */
export const MASTERED_AT = 80

const DELTAS: Record<ReviewEvent, number> = {
  'learn-knew': 5,
  'learn-didnt': -5,
  'quiz-choice-correct': 8,
  'quiz-typing-correct': 12,
  'quiz-listening-correct': 10,
  'quiz-wrong': -15,
}

export function emptyProgress(wordId: string): WordProgress {
  return { wordId, confidence: 0, timesCorrect: 0, timesWrong: 0 }
}

/** Apply a learn/test result to a word's progress. Pure — returns a new object. */
export function applyResult(prev: WordProgress, event: ReviewEvent, now: Date = new Date()): WordProgress {
  const delta = DELTAS[event]
  const confidence = Math.min(100, Math.max(0, prev.confidence + delta))
  const correct = delta > 0
  const next: WordProgress = {
    ...prev,
    confidence,
    timesCorrect: prev.timesCorrect + (correct ? 1 : 0),
    timesWrong: prev.timesWrong + (correct ? 0 : 1),
    lastReviewedAt: now.toISOString(),
  }
  if (!prev.learnedAt && confidence >= MASTERED_AT) next.learnedAt = now.toISOString()
  return next
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Confidence with a light decay for display and quiz-priority: −2 per full week
 * since the last review, floored at 0. Never written back to storage.
 */
export function effectiveConfidence(p: WordProgress | undefined, now: Date = new Date()): number {
  if (!p) return 0
  if (!p.lastReviewedAt) return p.confidence
  const weeks = Math.floor((now.getTime() - new Date(p.lastReviewedAt).getTime()) / WEEK_MS)
  return Math.max(0, p.confidence - 2 * Math.max(0, weeks))
}
