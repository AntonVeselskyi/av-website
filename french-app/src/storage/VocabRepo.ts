import type { Topic, Word, WordProgress } from '../types'

/**
 * Storage abstraction. Two implementations:
 * - LocalStorageRepo: bundled seed + localStorage overlays (default, fully offline)
 * - ApiRepo: AWS backend via API Gateway (enabled by VITE_API_URL)
 */
export interface VocabRepo {
  getTopics(): Promise<Topic[]>
  /** Seed + user additions/edits, minus local deletions. */
  getWords(): Promise<Word[]>
  /** Upsert a word (in-app add/edit form). */
  saveWord(word: Word): Promise<void>
  deleteWord(id: string): Promise<void>
  getAllProgress(): Promise<Record<string, WordProgress>>
  saveProgress(progress: WordProgress): Promise<void>
}
