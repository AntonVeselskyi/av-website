import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import type { Topic, Word, WordProgress } from '../types'
import { useVocab } from '../storage/RepoContext'
import { effectiveConfidence } from '../lib/confidence'
import WordModal from '../components/WordModal'

interface GraphNode {
  id: string
  label: string
  kind: 'topic' | 'word'
  color: string
  /** 0..1 — how "lit up" the node is (confidence); topics always 1 */
  glow: number
  val: number
  wordId?: string
  topicId?: string
}

interface GraphData {
  nodes: GraphNode[]
  links: { source: string; target: string }[]
}

/** Mix a hex color toward the dark background — dim = unknown, bright = mastered. */
function dim(hex: string, glow: number): string {
  const bg = [30, 30, 30]
  const c = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const t = 0.25 + 0.75 * glow
  const mixed = c.map((v, i) => Math.round(bg[i] + (v - bg[i]) * t))
  return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`
}

export function buildGraphData(
  topics: Topic[],
  words: Word[],
  progress: Record<string, WordProgress>,
): GraphData {
  const nodes: GraphNode[] = topics.map((t) => ({
    id: `topic:${t.id}`,
    label: `${t.emoji} ${t.nameEn}`,
    kind: 'topic' as const,
    color: t.color,
    glow: 1,
    val: 10,
    topicId: t.id,
  }))
  const topicColor = new Map(topics.map((t) => [t.id, t.color]))
  for (const w of words) {
    nodes.push({
      id: w.id,
      label: w.fr,
      kind: 'word',
      color: topicColor.get(w.topic) ?? '#8a5cf5',
      glow: effectiveConfidence(progress[w.id]) / 100,
      val: 2,
      wordId: w.id,
    })
  }
  const links = words
    .filter((w) => topicColor.has(w.topic))
    .map((w) => ({ source: w.id, target: `topic:${w.topic}` }))
  return { nodes, links }
}

export default function GraphPage() {
  const { topics, words, progress, loading, deleteWord } = useVocab()
  const [openWord, setOpenWord] = useState<Word | null>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined)

  const data = useMemo(() => buildGraphData(topics, words, progress), [topics, words, progress])
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (loading) return <p className="page-subtitle" style={{ padding: 28 }}>Loading…</p>

  return (
    <div className="graph-page" ref={wrapRef}>
      <div className="graph-legend">
        <div style={{ marginBottom: 6 }}>
          <strong>{words.length}</strong> words · brighter = better known
        </div>
        {topics.map((t) => (
          <div className="legend-item" key={t.id}>
            <span className="dot" style={{ background: t.color }} />
            {t.emoji} {t.nameEn}
          </div>
        ))}
      </div>

      <ForceGraph2D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="#1e1e1e"
        linkColor={() => 'rgba(140,140,140,0.18)'}
        linkWidth={1}
        nodeId="id"
        nodeVal="val"
        nodeLabel={() => ''}
        cooldownTicks={120}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as NodeObject<GraphNode>
          const x = n.x ?? 0
          const y = n.y ?? 0
          const isTopic = n.kind === 'topic'
          const r = isTopic ? 9 : 3.5
          const color = isTopic ? n.color : dim(n.color, n.glow)

          if (isTopic || n.glow >= 0.8) {
            ctx.shadowColor = n.color
            ctx.shadowBlur = isTopic ? 14 : 8
          }
          ctx.beginPath()
          ctx.arc(x, y, r, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
          ctx.shadowBlur = 0

          // Labels: topics always; words once zoomed in enough
          if (isTopic || globalScale > 1.7) {
            const fontSize = (isTopic ? 5.5 : 3.6) * Math.max(1, 12 / globalScale / 4)
            ctx.font = `${isTopic ? 600 : 400} ${fontSize}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = isTopic ? '#dadada' : 'rgba(200,200,200,0.75)'
            ctx.fillText(n.label, x, y + r + 1.5)
          }
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as NodeObject<GraphNode>
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, n.kind === 'topic' ? 12 : 6, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        onNodeClick={(node) => {
          const n = node as NodeObject<GraphNode>
          if (n.kind === 'word') {
            const w = words.find((word) => word.id === n.wordId)
            if (w) setOpenWord(w)
          } else if (n.topicId) {
            // Zoom to this topic's cluster
            const cluster = new Set([n.id, ...words.filter((w) => w.topic === n.topicId).map((w) => w.id)])
            graphRef.current?.zoomToFit(500, 60, (node2) => cluster.has((node2 as NodeObject<GraphNode>).id))
          }
        }}
      />

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
