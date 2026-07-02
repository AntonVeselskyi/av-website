import { useNavigate } from 'react-router-dom'
import type { Topic, Word, WordProgress } from '../types'
import ConfidenceBar from './ConfidenceBar'
import SpeakButton from './SpeakButton'
import TopicBadge from './TopicBadge'

interface Props {
  word: Word
  topic?: Topic
  progress?: WordProgress
  onClose: () => void
  /** Hide the Edit/Delete actions (e.g. when opened from the graph mid-quiz). */
  readOnly?: boolean
  onDelete?: (id: string) => void
}

export default function WordModal({ word, topic, progress, onClose, readOnly, onDelete }: Props) {
  const navigate = useNavigate()
  const confidence = progress?.confidence ?? 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-fr">{word.fr}</span>
          <SpeakButton text={word.fr} />
          <button type="button" className="icon-btn modal-close" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="transcriptions">
          <span className="ipa">{word.ipa}</span>
          <span className="cyr">{word.cyr}</span>
          {topic && <TopicBadge topic={topic} />}
        </div>

        <ConfidenceBar value={confidence} />

        <div className="modal-section">
          <h4>Translations</h4>
          <div className="translation-line">
            <span className="lang">EN</span>
            <span>{word.en.join(', ')}</span>
          </div>
          <div className="translation-line">
            <span className="lang">UK</span>
            <span>{word.uk.join(', ')}</span>
          </div>
        </div>

        <div className="modal-section">
          <h4>Examples</h4>
          {word.examples.map((ex, i) => (
            <div className="example" key={i}>
              <div className="ex-fr">
                {ex.fr} <SpeakButton text={ex.fr} />
              </div>
              <div className="ex-tr">
                <span className="ipa">{ex.ipa}</span> · <span className="cyr">{ex.cyr}</span>
              </div>
              <div className="ex-tr">🇬🇧 {ex.en}</div>
              <div className="ex-tr">🇺🇦 {ex.uk}</div>
            </div>
          ))}
        </div>

        <div className="modal-section">
          <h4>Progress</h4>
          <div className="meta-line">
            Confidence: {confidence}% · correct {progress?.timesCorrect ?? 0} · wrong {progress?.timesWrong ?? 0}
          </div>
          {word.source && <div className="meta-line">How I learned it: {word.source}</div>}
          <div className="meta-line">Added: {word.addedAt}</div>
          {progress?.learnedAt && <div className="meta-line">Mastered: {progress.learnedAt.slice(0, 10)} 🎉</div>}
          {progress?.lastReviewedAt && (
            <div className="meta-line">Last reviewed: {progress.lastReviewedAt.slice(0, 10)}</div>
          )}
        </div>

        {!readOnly && (
          <div className="form-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn" onClick={() => navigate(`/word/${word.id}/edit`)}>
              ✏️ Edit
            </button>
            {onDelete && (
              <button
                type="button"
                className="btn bad"
                onClick={() => {
                  if (confirm(`Delete "${word.fr}"?`)) {
                    onDelete(word.id)
                    onClose()
                  }
                }}
              >
                🗑 Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
