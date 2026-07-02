import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ReviewEvent, Topic, Word, WordProgress } from '../types'
import type { VocabRepo } from './VocabRepo'
import { createRepo } from './createRepo'
import { applyResult, emptyProgress } from '../lib/confidence'

interface VocabState {
  repo: VocabRepo
  topics: Topic[]
  words: Word[]
  progress: Record<string, WordProgress>
  loading: boolean
  /** Upsert a word and refresh the word list. */
  saveWord: (word: Word) => Promise<void>
  deleteWord: (id: string) => Promise<void>
  /** Record a learn/test result for a word; updates confidence optimistically. */
  recordResult: (wordId: string, event: ReviewEvent) => void
}

const VocabContext = createContext<VocabState | null>(null)

export function VocabProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => createRepo(), [])
  const [topics, setTopics] = useState<Topic[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [progress, setProgress] = useState<Record<string, WordProgress>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([repo.getTopics(), repo.getWords(), repo.getAllProgress()])
      .then(([t, w, p]) => {
        if (cancelled) return
        setTopics(t)
        setWords(w)
        setProgress(p)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to load vocabulary', e)
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [repo])

  const saveWord = useCallback(
    async (word: Word) => {
      await repo.saveWord(word)
      setWords(await repo.getWords())
    },
    [repo],
  )

  const deleteWord = useCallback(
    async (id: string) => {
      await repo.deleteWord(id)
      setWords(await repo.getWords())
    },
    [repo],
  )

  const recordResult = useCallback(
    (wordId: string, event: ReviewEvent) => {
      setProgress((prev) => {
        const next = applyResult(prev[wordId] ?? emptyProgress(wordId), event)
        repo.saveProgress(next).catch((e) => console.error('Failed to save progress', e))
        return { ...prev, [wordId]: next }
      })
    },
    [repo],
  )

  const value = useMemo(
    () => ({ repo, topics, words, progress, loading, saveWord, deleteWord, recordResult }),
    [repo, topics, words, progress, loading, saveWord, deleteWord, recordResult],
  )

  return <VocabContext.Provider value={value}>{children}</VocabContext.Provider>
}

export function useVocab(): VocabState {
  const ctx = useContext(VocabContext)
  if (!ctx) throw new Error('useVocab must be used inside <VocabProvider>')
  return ctx
}
