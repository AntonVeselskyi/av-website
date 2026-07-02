import { useMemo } from 'react'
import { useVocab } from '../storage/RepoContext'
import { topicAchievements } from '../lib/achievements'
import { MASTERED_AT } from '../lib/confidence'
import ConfidenceBar from '../components/ConfidenceBar'

const TIER_LABEL = { none: '—', bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold' } as const

export default function AchievementsPage() {
  const { topics, words, progress, loading } = useVocab()

  const achievements = useMemo(
    () => topicAchievements(topics, words, progress).sort((a, b) => b.completion - a.completion),
    [topics, words, progress],
  )

  const totalMastered = useMemo(
    () => words.filter((w) => (progress[w.id]?.confidence ?? 0) >= MASTERED_AT).length,
    [words, progress],
  )
  const goldTopics = achievements.filter((a) => a.tier === 'gold').length

  if (loading) return <p className="page-subtitle">Loading…</p>

  return (
    <div>
      <h1 className="page-title">Achievements</h1>
      <p className="page-subtitle">Master a word (≥{MASTERED_AT}% confidence) to fill up its topic</p>

      <div className="ach-stats">
        <div className="stat-tile">
          <div className="stat-value">{words.length}</div>
          <div className="stat-label">words in dictionary</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{totalMastered}</div>
          <div className="stat-label">words mastered</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">
            {goldTopics}/{topics.length}
          </div>
          <div className="stat-label">topics completed</div>
        </div>
      </div>

      <div className="ach-list">
        {achievements.map((a) => (
          <div className="ach-row" key={a.topic.id}>
            <span className="ach-emoji">{a.topic.emoji}</span>
            <div className="ach-names">
              <div className="ach-name">{a.topic.nameEn}</div>
              <div className="ach-name-uk">{a.topic.nameUk}</div>
            </div>
            <div className="ach-progress">
              <ConfidenceBar value={a.completion} />
            </div>
            <span className="ach-count">
              {a.masteredWords}/{a.totalWords} mastered
            </span>
            <span className={`tier ${a.tier}`}>{TIER_LABEL[a.tier]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
