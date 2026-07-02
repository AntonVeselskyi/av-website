function colorFor(confidence: number): string {
  if (confidence >= 80) return 'var(--green)'
  if (confidence >= 40) return 'var(--accent)'
  return '#5a5a5a'
}

export default function ConfidenceBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  return (
    <div className="conf-row">
      <div className="conf-bar">
        <div className="conf-bar-fill" style={{ width: `${value}%`, background: colorFor(value) }} />
      </div>
      {showLabel && <span className="conf-label">{value}%</span>}
    </div>
  )
}
