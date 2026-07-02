import { useMemo, useState } from 'react'
import type { Word } from '../types'
import { useVocab } from '../storage/RepoContext'
import { recentWords } from '../lib/quiz'
import { effectiveConfidence } from '../lib/confidence'
import SpeakButton from '../components/SpeakButton'
import TopicBadge from '../components/TopicBadge'

type Selection = { kind: 'topic'; topicId: string } | { kind: 'recent' }

function Flashcard({ word, onGrade }: { word: Word; onGrade: (knew: boolean) => void }) {
  const [flipped, setFlipped] = useState(false)

  return (
    <>
      <div className="flashcard" onClick={() => setFlipped(true)}>
        {!flipped ? (
          <>
            <div className="fc-fr">
              {word.fr} <SpeakButton text={word.fr} />
            </div>
            <div className="transcriptions" style={{ justifyContent: 'center' }}>
              <span className="ipa">{word.ipa}</span>
              <span className="cyr">{word.cyr}</span>
            </div>
            <div className="fc-hint">click to flip</div>
          </>
        ) : (
          <>
            <div className="fc-fr">{word.fr}</div>
            <div className="translation-line" style={{ justifyContent: 'center' }}>
              <span className="lang">EN</span> {word.en.join(', ')}
            </div>
            <div className="translation-line" style={{ justifyContent: 'center' }}>
              <span className="lang">UK</span> {word.uk.join(', ')}
            </div>
            {word.examples[0] && (
              <div className="example" style={{ textAlign: 'left', marginTop: 18, width: '100%' }}>
                <div className="ex-fr">
                  {word.examples[0].fr} <SpeakButton text={word.examples[0].fr} />
                </div>
                <div className="ex-tr">
                  <span className="cyr">{word.examples[0].cyr}</span>
                </div>
                <div className="ex-tr">🇺🇦 {word.examples[0].uk}</div>
              </div>
            )}
          </>
        )}
      </div>
      {flipped && (
        <div className="fc-actions">
          <button type="button" className="btn bad" onClick={() => onGrade(false)}>
            Didn't know
          </button>
          <button type="button" className="btn good" onClick={() => onGrade(true)}>
            Knew it
          </button>
        </div>
      )}
    </>
  )
}

export default function LearnPage() {
  const { topics, words, progress, loading, recordResult } = useVocab()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [index, setIndex] = useState(0)
  const [round, setRound] = useState(0) // forces remount of Flashcard per word

  const session = useMemo<Word[]>(() => {
    if (!selection) return []
    const pool =
      selection.kind === 'recent' ? recentWords(words) : words.filter((w) => w.topic === selection.topicId)
    // Weakest words first so a short session hits what needs attention.
    return [...pool].sort(
      (a, b) => effectiveConfidence(progress[a.id]) - effectiveConfidence(progress[b.id]),
    )
    // progress deliberately omitted: reordering mid-session would be confusing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, words])

  const grade = (knew: boolean) => {
    recordResult(session[index].id, knew ? 'learn-knew' : 'learn-didnt')
    setIndex(index + 1)
    setRound(round + 1)
  }

  if (loading) return <p className="page-subtitle">Loading…</p>

  if (!selection) {
    return (
      <div className="mode-setup">
        <h1 className="page-title">Learn</h1>
        <p className="page-subtitle">Flashcards: see the word, flip, grade yourself — confidence follows</p>

        <h3>Refresh recent words</h3>
        <button type="button" className="btn primary" onClick={() => setSelection({ kind: 'recent' })}>
          🕓 15 most recent words
        </button>

        <h3>Learn by topic</h3>
        <div className="chip-row">
          {topics.map((t) => (
            <button
              type="button"
              key={t.id}
              className="chip"
              onClick={() => setSelection({ kind: 'topic', topicId: t.id })}
            >
              {t.emoji} {t.nameEn}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (index >= session.length) {
    return (
      <div className="flashcard-wrap">
        <div className="flashcard" style={{ cursor: 'default' }}>
          <div className="fc-fr">🎉 Done!</div>
          <div className="fc-hint">You reviewed {session.length} words</div>
        </div>
        <div className="fc-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setSelection(null)
              setIndex(0)
            }}
          >
            Back to topics
          </button>
        </div>
      </div>
    )
  }

  const word = session[index]
  const topic = topics.find((t) => t.id === word.topic)

  return (
    <div className="flashcard-wrap">
      <div className="fc-progress">
        {index + 1} / {session.length} {topic && <TopicBadge topic={topic} />}
      </div>
      <Flashcard key={round} word={word} onGrade={grade} />
    </div>
  )
}
