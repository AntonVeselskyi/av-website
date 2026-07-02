import type { Topic, Word } from '../types'
import ConfidenceBar from './ConfidenceBar'
import SpeakButton from './SpeakButton'

interface Props {
  word: Word
  topic?: Topic
  confidence: number
  onOpen: (word: Word) => void
}

export default function WordCard({ word, topic, confidence, onOpen }: Props) {
  return (
    <div className="word-card" onClick={() => onOpen(word)}>
      <div className="word-card-fr">
        {word.fr} <SpeakButton text={word.fr} />
      </div>
      <div className="word-card-uk">{word.uk.join(', ')}</div>
      <div className="word-card-foot">
        {topic && (
          <span title={topic.nameEn} style={{ fontSize: 14 }}>
            {topic.emoji}
          </span>
        )}
        <ConfidenceBar value={confidence} />
      </div>
    </div>
  )
}
