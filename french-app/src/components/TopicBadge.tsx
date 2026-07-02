import type { Topic } from '../types'

export default function TopicBadge({ topic }: { topic: Topic }) {
  return (
    <span className="topic-badge" style={{ borderColor: topic.color, color: topic.color }}>
      {topic.emoji} {topic.nameEn}
    </span>
  )
}
