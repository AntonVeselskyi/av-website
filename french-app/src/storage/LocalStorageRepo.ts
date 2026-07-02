import type { SeedFile, Topic, Word, WordProgress } from '../types'
import type { VocabRepo } from './VocabRepo'

const KEY_OVERRIDES = 'fr.words.overrides'
const KEY_DELETED = 'fr.words.deleted'
const KEY_PROGRESS = 'fr.progress'

/** Minimal slice of the Storage API so tests can pass a Map-backed stub. */
export interface KVStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Offline repository: words = bundled seed overlaid with locally added/edited
 * words (`fr.words.overrides`) minus tombstoned ids (`fr.words.deleted`).
 * Progress lives entirely in `fr.progress`. The seed is read fresh from the
 * bundle on every load, so words added by the /add-word skill appear
 * automatically after rebuild/HMR without any migration step.
 */
export class LocalStorageRepo implements VocabRepo {
  constructor(
    private seed: SeedFile,
    private store: KVStore = localStorage,
  ) {}

  private read<T>(key: string, fallback: T): T {
    const raw = this.store.getItem(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private write(key: string, value: unknown): void {
    this.store.setItem(key, JSON.stringify(value))
  }

  async getTopics(): Promise<Topic[]> {
    return this.seed.topics
  }

  async getWords(): Promise<Word[]> {
    const overrides = this.read<Record<string, Word>>(KEY_OVERRIDES, {})
    const deleted = new Set(this.read<string[]>(KEY_DELETED, []))
    const seedIds = new Set(this.seed.words.map((w) => w.id))
    const fromSeed = this.seed.words
      .filter((w) => !deleted.has(w.id))
      .map((w) => overrides[w.id] ?? w)
    const added = Object.values(overrides).filter((w) => !seedIds.has(w.id) && !deleted.has(w.id))
    return [...fromSeed, ...added]
  }

  async saveWord(word: Word): Promise<void> {
    const overrides = this.read<Record<string, Word>>(KEY_OVERRIDES, {})
    overrides[word.id] = word
    this.write(KEY_OVERRIDES, overrides)
    const deleted = this.read<string[]>(KEY_DELETED, [])
    if (deleted.includes(word.id)) {
      this.write(
        KEY_DELETED,
        deleted.filter((id) => id !== word.id),
      )
    }
  }

  async deleteWord(id: string): Promise<void> {
    const deleted = this.read<string[]>(KEY_DELETED, [])
    if (!deleted.includes(id)) this.write(KEY_DELETED, [...deleted, id])
    const overrides = this.read<Record<string, Word>>(KEY_OVERRIDES, {})
    if (overrides[id]) {
      delete overrides[id]
      this.write(KEY_OVERRIDES, overrides)
    }
  }

  async getAllProgress(): Promise<Record<string, WordProgress>> {
    return this.read<Record<string, WordProgress>>(KEY_PROGRESS, {})
  }

  async saveProgress(progress: WordProgress): Promise<void> {
    const all = this.read<Record<string, WordProgress>>(KEY_PROGRESS, {})
    all[progress.wordId] = progress
    this.write(KEY_PROGRESS, all)
  }
}
