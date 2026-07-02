import { useMemo, useState } from 'react'
import type { Word } from '../types'
import { useVocab } from '../storage/RepoContext'
import WordCard from '../components/WordCard'
import WordModal from '../components/WordModal'

type SortMode = 'alpha' | 'confidence' | 'recent'

export default function DictionaryPage() {
  const { topics, words, progress, loading, deleteWord } = useVocab()
  const [query, setQuery] = useState('')
  const [topicFilter, setTopicFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('alpha')
  const [openWord, setOpenWord] = useState<Word | null>(null)

  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = words.filter((w) => {
      if (topicFilter && w.topic !== topicFilter) return false
      if (!q) return true
      return (
        w.fr.toLowerCase().includes(q) ||
        w.en.some((t) => t.toLowerCase().includes(q)) ||
        w.uk.some((t) => t.toLowerCase().includes(q)) ||
        w.cyr.toLowerCase().includes(q)
      )
    })
    list = [...list]
    if (sort === 'alpha') list.sort((a, b) => a.fr.localeCompare(b.fr, 'fr'))
    if (sort === 'confidence')
      list.sort((a, b) => (progress[a.id]?.confidence ?? 0) - (progress[b.id]?.confidence ?? 0))
    if (sort === 'recent') list.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    return list
  }, [words, query, topicFilter, sort, progress])

  if (loading) return <p className="page-subtitle">Loading…</p>

  return (
    <div>
      <h1 className="page-title">Dictionary</h1>
      <p className="page-subtitle">
        {words.length} words · click a card to see pronunciation, examples and progress
      </p>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search french / english / українською…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="alpha">A → Z</option>
          <option value="confidence">Weakest first</option>
          <option value="recent">Recently added</option>
        </select>
      </div>

      <div className="chip-row">
        <button type="button" className={topicFilter === null ? 'chip active' : 'chip'} onClick={() => setTopicFilter(null)}>
          All
        </button>
        {topics.map((t) => (
          <button
            type="button"
            key={t.id}
            className={topicFilter === t.id ? 'chip active' : 'chip'}
            onClick={() => setTopicFilter(topicFilter === t.id ? null : t.id)}
          >
            {t.emoji} {t.nameEn}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty-note">No words match. Try another search, or add a new word with ➕</div>
      ) : (
        <div className="card-grid">
          {visible.map((w) => (
            <WordCard
              key={w.id}
              word={w}
              topic={topicById.get(w.topic)}
              confidence={progress[w.id]?.confidence ?? 0}
              onOpen={setOpenWord}
            />
          ))}
        </div>
      )}

      {openWord && (
        <WordModal
          word={openWord}
          topic={topicById.get(openWord.topic)}
          progress={progress[openWord.id]}
          onClose={() => setOpenWord(null)}
          onDelete={deleteWord}
        />
      )}
    </div>
  )
}
