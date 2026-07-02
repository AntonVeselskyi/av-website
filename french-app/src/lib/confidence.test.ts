import { describe, expect, it } from 'vitest'
import { applyResult, effectiveConfidence, emptyProgress, MASTERED_AT } from './confidence'

const NOW = new Date('2026-07-02T12:00:00Z')

describe('applyResult', () => {
  it('applies gains per event type', () => {
    expect(applyResult(emptyProgress('w'), 'learn-knew', NOW).confidence).toBe(5)
    expect(applyResult(emptyProgress('w'), 'quiz-choice-correct', NOW).confidence).toBe(8)
    expect(applyResult(emptyProgress('w'), 'quiz-typing-correct', NOW).confidence).toBe(12)
    expect(applyResult(emptyProgress('w'), 'quiz-listening-correct', NOW).confidence).toBe(10)
  })

  it('applies penalties and clamps at 0', () => {
    const p = { ...emptyProgress('w'), confidence: 10 }
    expect(applyResult(p, 'quiz-wrong', NOW).confidence).toBe(0)
    expect(applyResult(emptyProgress('w'), 'learn-didnt', NOW).confidence).toBe(0)
  })

  it('clamps at 100', () => {
    const p = { ...emptyProgress('w'), confidence: 95 }
    expect(applyResult(p, 'quiz-typing-correct', NOW).confidence).toBe(100)
  })

  it('counts correct and wrong answers', () => {
    let p = emptyProgress('w')
    p = applyResult(p, 'quiz-choice-correct', NOW)
    p = applyResult(p, 'quiz-wrong', NOW)
    p = applyResult(p, 'learn-didnt', NOW)
    expect(p.timesCorrect).toBe(1)
    expect(p.timesWrong).toBe(2)
  })

  it('sets learnedAt when crossing the mastered threshold, and keeps the first date', () => {
    const before = { ...emptyProgress('w'), confidence: MASTERED_AT - 5 }
    const crossed = applyResult(before, 'quiz-typing-correct', NOW)
    expect(crossed.confidence).toBeGreaterThanOrEqual(MASTERED_AT)
    expect(crossed.learnedAt).toBe(NOW.toISOString())

    const later = new Date('2026-08-01T12:00:00Z')
    const again = applyResult(crossed, 'quiz-typing-correct', later)
    expect(again.learnedAt).toBe(NOW.toISOString())
  })

  it('updates lastReviewedAt', () => {
    expect(applyResult(emptyProgress('w'), 'learn-knew', NOW).lastReviewedAt).toBe(NOW.toISOString())
  })
})

describe('effectiveConfidence', () => {
  it('is 0 for missing progress', () => {
    expect(effectiveConfidence(undefined, NOW)).toBe(0)
  })

  it('returns stored confidence when never reviewed', () => {
    expect(effectiveConfidence({ ...emptyProgress('w'), confidence: 40 }, NOW)).toBe(40)
  })

  it('decays 2 points per full week, floored at 0', () => {
    const p = {
      ...emptyProgress('w'),
      confidence: 50,
      lastReviewedAt: '2026-06-04T12:00:00Z', // 4 weeks before NOW
    }
    expect(effectiveConfidence(p, NOW)).toBe(42)

    const weak = { ...p, confidence: 3 }
    expect(effectiveConfidence(weak, NOW)).toBe(0)
  })

  it('does not decay within the first week', () => {
    const p = { ...emptyProgress('w'), confidence: 50, lastReviewedAt: '2026-06-30T12:00:00Z' }
    expect(effectiveConfidence(p, NOW)).toBe(50)
  })
})
