import type { Topic, Word, WordProgress } from '../types'
import { MASTERED_AT } from './confidence'

export type Tier = 'none' | 'bronze' | 'silver' | 'gold'

export interface TopicAchievement {
  topic: Topic
  totalWords: number
  masteredWords: number
  /** 0–100, share of words at or above the mastered threshold */
  completion: number
  /** 0–100, average confidence across the topic's words */
  avgConfidence: number
  tier: Tier
}

export function tierFor(completion: number): Tier {
  if (completion >= 100) return 'gold'
  if (completion >= 67) return 'silver'
  if (completion >= 34) return 'bronze'
  return 'none'
}

export function topicAchievements(
  topics: Topic[],
  words: Word[],
  progress: Record<string, WordProgress>,
): TopicAchievement[] {
  return topics.map((topic) => {
    const topicWords = words.filter((w) => w.topic === topic.id)
    const confidences = topicWords.map((w) => progress[w.id]?.confidence ?? 0)
    const masteredWords = confidences.filter((c) => c >= MASTERED_AT).length
    const completion = topicWords.length === 0 ? 0 : Math.round((masteredWords / topicWords.length) * 100)
    const avgConfidence =
      topicWords.length === 0 ? 0 : Math.round(confidences.reduce((a, b) => a + b, 0) / topicWords.length)
    return { topic, totalWords: topicWords.length, masteredWords, completion, avgConfidence, tier: tierFor(completion) }
  })
}
