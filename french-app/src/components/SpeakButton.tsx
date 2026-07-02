import { speak } from '../lib/speech'

export default function SpeakButton({ text, title = 'Pronounce' }: { text: string; title?: string }) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        speak(text)
      }}
    >
      🔊
    </button>
  )
}
