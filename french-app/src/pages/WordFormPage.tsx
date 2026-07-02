import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Example, Word } from '../types'
import { useVocab } from '../storage/RepoContext'

const EMPTY_EXAMPLE: Example = { fr: '', en: '', uk: '', ipa: '', cyr: '' }

function slugify(fr: string): string {
  return fr
    .toLowerCase()
    .replace(/^(le |la |les |l'|un |une |des )/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function WordFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { topics, words, loading, saveWord } = useVocab()
  const editing = words.find((w) => w.id === id)

  const [fr, setFr] = useState('')
  const [en, setEn] = useState('')
  const [uk, setUk] = useState('')
  const [ipa, setIpa] = useState('')
  const [cyr, setCyr] = useState('')
  const [topic, setTopic] = useState('')
  const [source, setSource] = useState('')
  const [examples, setExamples] = useState<Example[]>([{ ...EMPTY_EXAMPLE }])
  const [error, setError] = useState('')

  useEffect(() => {
    if (editing) {
      setFr(editing.fr)
      setEn(editing.en.join(', '))
      setUk(editing.uk.join(', '))
      setIpa(editing.ipa)
      setCyr(editing.cyr)
      setTopic(editing.topic)
      setSource(editing.source ?? '')
      setExamples(editing.examples.length ? editing.examples : [{ ...EMPTY_EXAMPLE }])
    }
  }, [editing])

  useEffect(() => {
    if (!editing && !topic && topics.length) setTopic(topics[0].id)
  }, [topics, editing, topic])

  if (loading) return <p className="page-subtitle">Loading…</p>
  if (id && !editing) return <p className="page-subtitle">Word not found.</p>

  const setExample = (i: number, field: keyof Example, value: string) => {
    setExamples((prev) => prev.map((ex, j) => (j === i ? { ...ex, [field]: value } : ex)))
  }

  const splitList = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const enList = splitList(en)
    const ukList = splitList(uk)
    const validExamples = examples.filter((ex) => ex.fr.trim())
    if (!fr.trim() || enList.length === 0 || ukList.length === 0 || !ipa.trim() || !cyr.trim()) {
      setError('French word, translations and both transcriptions are required.')
      return
    }
    if (validExamples.length === 0) {
      setError('At least one example (French sentence) is required.')
      return
    }
    const newId = editing?.id ?? slugify(fr)
    if (!editing && words.some((w) => w.id === newId)) {
      setError(`A word with id "${newId}" already exists.`)
      return
    }
    const word: Word = {
      id: newId,
      fr: fr.trim(),
      en: enList,
      uk: ukList,
      ipa: ipa.trim(),
      cyr: cyr.trim(),
      topic,
      examples: validExamples,
      source: source.trim() || undefined,
      addedAt: editing?.addedAt ?? new Date().toISOString().slice(0, 10),
    }
    await saveWord(word)
    navigate('/')
  }

  return (
    <div>
      <h1 className="page-title">{editing ? `Edit: ${editing.fr}` : 'Add a word'}</h1>
      <p className="page-subtitle">
        Tip: the /add-word Claude skill fills transcriptions and examples for you
      </p>

      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label>
            French word *
            <input className="input" value={fr} onChange={(e) => setFr(e.target.value)} placeholder="le chien" />
          </label>
          <label>
            Topic *
            <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.nameEn} · {t.nameUk}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            English translation(s) * <span style={{ color: 'var(--text-faint)' }}>comma-separated</span>
            <input className="input" value={en} onChange={(e) => setEn(e.target.value)} placeholder="dog" />
          </label>
          <label>
            Українські переклади *
            <input className="input" value={uk} onChange={(e) => setUk(e.target.value)} placeholder="собака, пес" />
          </label>
        </div>

        <div className="form-row">
          <label>
            IPA transcription *
            <input className="input" value={ipa} onChange={(e) => setIpa(e.target.value)} placeholder="/ʃjɛ̃/" />
          </label>
          <label>
            Транскрипція кирилицею *
            <input className="input" value={cyr} onChange={(e) => setCyr(e.target.value)} placeholder="шьєн" />
          </label>
        </div>

        <label>
          How I learned it
          <input
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Duolingo unit 3 / heard in a café / …"
          />
        </label>

        {examples.map((ex, i) => (
          <fieldset className="example-fieldset" key={i}>
            <legend>Example {i + 1}</legend>
            <input
              className="input"
              value={ex.fr}
              onChange={(e) => setExample(i, 'fr', e.target.value)}
              placeholder="French sentence *"
            />
            <div className="form-row">
              <input
                className="input"
                value={ex.en}
                onChange={(e) => setExample(i, 'en', e.target.value)}
                placeholder="English translation"
              />
              <input
                className="input"
                value={ex.uk}
                onChange={(e) => setExample(i, 'uk', e.target.value)}
                placeholder="Український переклад"
              />
            </div>
            <div className="form-row">
              <input
                className="input"
                value={ex.ipa}
                onChange={(e) => setExample(i, 'ipa', e.target.value)}
                placeholder="IPA of the sentence"
              />
              <input
                className="input"
                value={ex.cyr}
                onChange={(e) => setExample(i, 'cyr', e.target.value)}
                placeholder="кирилицею"
              />
            </div>
          </fieldset>
        ))}

        <div>
          <button type="button" className="btn ghost" onClick={() => setExamples([...examples, { ...EMPTY_EXAMPLE }])}>
            + another example
          </button>
        </div>

        {error && <div className="quiz-feedback bad">{error}</div>}

        <div className="form-actions">
          <button type="submit" className="btn primary">
            {editing ? 'Save changes' : 'Add word'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
