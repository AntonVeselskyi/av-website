import { beforeEach, describe, expect, it } from 'vitest'
import type { SeedFile, Word } from '../types'
import { LocalStorageRepo, type KVStore } from './LocalStorageRepo'
import { emptyProgress } from '../lib/confidence'

function makeStore(): KVStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

function word(id: string, fr = id): Word {
  return {
    id,
    fr,
    en: ['x'],
    uk: ['х'],
    ipa: '/x/',
    cyr: 'х',
    topic: 't1',
    examples: [{ fr: 'x', en: 'x', uk: 'х', ipa: '/x/', cyr: 'х' }],
    addedAt: '2026-07-01',
  }
}

const SEED: SeedFile = {
  version: 1,
  topics: [{ id: 't1', nameEn: 'T1', nameUk: 'Т1', emoji: '🧪', color: '#8a5cf5' }],
  words: [word('a'), word('b')],
}

describe('LocalStorageRepo', () => {
  let store: KVStore
  let repo: LocalStorageRepo

  beforeEach(() => {
    store = makeStore()
    repo = new LocalStorageRepo(SEED, store)
  })

  it('returns seed words by default', async () => {
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['a', 'b'])
    expect(await repo.getTopics()).toEqual(SEED.topics)
  })

  it('adds new words via saveWord', async () => {
    await repo.saveWord(word('c'))
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('overrides seed words in place', async () => {
    await repo.saveWord({ ...word('a'), fr: 'edited' })
    const words = await repo.getWords()
    expect(words.map((w) => w.id)).toEqual(['a', 'b'])
    expect(words[0].fr).toBe('edited')
  })

  it('tombstones deleted seed words', async () => {
    await repo.deleteWord('a')
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['b'])
  })

  it('deletes locally added words entirely', async () => {
    await repo.saveWord(word('c'))
    await repo.deleteWord('c')
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('re-saving a deleted word revives it', async () => {
    await repo.deleteWord('a')
    await repo.saveWord(word('a'))
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('round-trips progress', async () => {
    const p = { ...emptyProgress('a'), confidence: 42 }
    await repo.saveProgress(p)
    expect(await repo.getAllProgress()).toEqual({ a: p })
  })

  it('survives corrupt localStorage values', async () => {
    store.setItem('fr.words.overrides', 'not-json{')
    expect((await repo.getWords()).map((w) => w.id)).toEqual(['a', 'b'])
  })
})
