import { useMemo, useState } from 'react'
import type { Word } from '../types'
import { useVocab } from '../storage/RepoContext'
import {
  buildQuestion,
  checkTypedAnswer,
  correctEvent,
  pickQuizWords,
  recentWords,
  type QuizMode,
  type QuizQuestion,
} from '../lib/quiz'
import { speak } from '../lib/speech'
import SpeakButton from '../components/SpeakButton'

const QUIZ_LENGTH = 10

type Scope = { kind: 'topic'; topicId: string } | { kind: 'recent' } | { kind: 'random' }

interface Answered {
  word: Word
  correct: boolean
  deltaBefore: number
  deltaAfter: number
}

function ChoiceQuestion({
  question,
  onAnswer,
}: {
  question: QuizQuestion
  onAnswer: (correct: boolean) => void
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const done = picked !== null
  const correct = done && picked === question.answerIndex

  const prompt =
    question.mode === 'listening' ? (
      <div className="fc-fr" style={{ textAlign: 'center' }}>
        <button type="button" className="btn primary" onClick={() => speak(question.word.fr)}>
          🔊 Listen
        </button>
        <div className="fc-hint">pick what you heard</div>
      </div>
    ) : (
      <div className="fc-fr" style={{ textAlign: 'center' }}>
        {question.word.fr} <SpeakButton text={question.word.fr} />
      </div>
    )

  return (
    <>
      {prompt}
      <div className="quiz-options">
        {question.options!.map((opt, i) => {
          let cls = 'btn quiz-option'
          if (done && i === question.answerIndex) cls += ' correct'
          if (done && i === picked && !correct) cls += ' wrong'
          return (
            <button
              type="button"
              key={i}
              className={cls}
              disabled={done}
              onClick={() => {
                setPicked(i)
                setTimeout(() => onAnswer(i === question.answerIndex), 900)
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>
      <div className={`quiz-feedback ${done ? (correct ? 'good' : 'bad') : ''}`}>
        {done && (correct ? 'Correct!' : `It was: ${question.options![question.answerIndex!]}`)}
      </div>
    </>
  )
}

function TypingQuestion({
  question,
  onAnswer,
}: {
  question: QuizQuestion
  onAnswer: (correct: boolean) => void
}) {
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<boolean | null>(null)

  const submit = () => {
    if (result !== null) return
    const ok = checkTypedAnswer(question.word.fr, typed)
    setResult(ok)
    setTimeout(() => onAnswer(ok), ok ? 900 : 1800)
  }

  return (
    <>
      <div className="fc-fr" style={{ textAlign: 'center', fontSize: 24 }}>
        🇺🇦 {question.word.uk.join(', ')}
      </div>
      <div className="fc-hint" style={{ textAlign: 'center' }}>
        🇬🇧 {question.word.en.join(', ')} — type it in French
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          autoFocus
          value={typed}
          disabled={result !== null}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="en français…"
        />
        <button type="button" className="btn primary" onClick={submit} disabled={result !== null}>
          Check
        </button>
      </div>
      <div className={`quiz-feedback ${result === null ? '' : result ? 'good' : 'bad'}`}>
        {result === true && 'Correct!'}
        {result === false && `It was: ${question.word.fr}`}
      </div>
    </>
  )
}

export default function TestPage() {
  const { topics, words, progress, loading, recordResult } = useVocab()
  const [scope, setScope] = useState<Scope>({ kind: 'random' })
  const [mode, setMode] = useState<QuizMode>('choice')
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answered[]>([])

  const scopePool = useMemo(() => {
    if (scope.kind === 'topic') return words.filter((w) => w.topic === scope.topicId)
    if (scope.kind === 'recent') return recentWords(words)
    return words
  }, [scope, words])

  const start = () => {
    const picked = pickQuizWords(scopePool, progress, QUIZ_LENGTH)
    setQuestions(picked.map((w) => buildQuestion(mode, w, words)))
    setIndex(0)
    setAnswers([])
  }

  const answer = (correct: boolean) => {
    const q = questions![index]
    const before = progress[q.word.id]?.confidence ?? 0
    recordResult(q.word.id, correct ? correctEvent[q.mode] : 'quiz-wrong')
    const gain = { choice: 8, typing: 12, listening: 10 }[q.mode]
    const after = Math.min(100, Math.max(0, before + (correct ? gain : -15)))
    setAnswers((prev) => [...prev, { word: q.word, correct, deltaBefore: before, deltaAfter: after }])
    setIndex(index + 1)
  }

  if (loading) return <p className="page-subtitle">Loading…</p>

  if (!questions) {
    return (
      <div className="mode-setup">
        <h1 className="page-title">Test</h1>
        <p className="page-subtitle">Quiz yourself — right answers raise confidence, wrong ones drop it</p>

        <h3>What to test</h3>
        <div className="chip-row">
          <button type="button" className={scope.kind === 'random' ? 'chip active' : 'chip'} onClick={() => setScope({ kind: 'random' })}>
            🎲 Random
          </button>
          <button type="button" className={scope.kind === 'recent' ? 'chip active' : 'chip'} onClick={() => setScope({ kind: 'recent' })}>
            🕓 Recently added
          </button>
          {topics.map((t) => (
            <button
              type="button"
              key={t.id}
              className={scope.kind === 'topic' && scope.topicId === t.id ? 'chip active' : 'chip'}
              onClick={() => setScope({ kind: 'topic', topicId: t.id })}
            >
              {t.emoji} {t.nameEn}
            </button>
          ))}
        </div>

        <h3>Mode</h3>
        <div className="chip-row">
          <button type="button" className={mode === 'choice' ? 'chip active' : 'chip'} onClick={() => setMode('choice')}>
            🔤 FR → UK choice
          </button>
          <button type="button" className={mode === 'typing' ? 'chip active' : 'chip'} onClick={() => setMode('typing')}>
            ⌨️ UK → FR typing
          </button>
          <button type="button" className={mode === 'listening' ? 'chip active' : 'chip'} onClick={() => setMode('listening')}>
            🎧 Listening
          </button>
        </div>

        <div style={{ marginTop: 26 }}>
          <button type="button" className="btn primary" onClick={start} disabled={scopePool.length < 2}>
            Start test ({Math.min(QUIZ_LENGTH, scopePool.length)} questions)
          </button>
        </div>
      </div>
    )
  }

  if (index >= questions.length) {
    const score = answers.filter((a) => a.correct).length
    return (
      <div className="flashcard-wrap">
        <h1 className="page-title" style={{ textAlign: 'center' }}>
          {score}/{answers.length} correct {score === answers.length ? '🏆' : score >= answers.length / 2 ? '💪' : '📚'}
        </h1>
        <div className="result-list">
          {answers.map((a, i) => (
            <div className="result-row" key={i}>
              <span>{a.correct ? '✅' : '❌'}</span>
              <span>
                {a.word.fr} — {a.word.uk[0]}
              </span>
              <span className={`delta ${a.deltaAfter >= a.deltaBefore ? 'up' : 'down'}`}>
                {a.deltaBefore}% → {a.deltaAfter}%
              </span>
            </div>
          ))}
        </div>
        <div className="fc-actions">
          <button type="button" className="btn primary" onClick={() => setQuestions(null)}>
            New test
          </button>
        </div>
      </div>
    )
  }

  const q = questions[index]
  return (
    <div className="flashcard-wrap">
      <div className="fc-progress">
        {index + 1} / {questions.length}
      </div>
      {q.mode === 'typing' ? (
        <TypingQuestion key={index} question={q} onAnswer={answer} />
      ) : (
        <ChoiceQuestion key={index} question={q} onAnswer={answer} />
      )}
    </div>
  )
}
