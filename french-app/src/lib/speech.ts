// SpeechSynthesis wrapper for French pronunciation. Free, runs in the browser.

let frVoice: SpeechSynthesisVoice | undefined

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'fr-FR' && v.localService) ??
    voices.find((v) => v.lang === 'fr-FR') ??
    voices.find((v) => v.lang.startsWith('fr'))
  )
}

// Chrome loads voices asynchronously: getVoices() is empty until voiceschanged fires.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  frVoice = pickVoice()
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    frVoice = pickVoice()
  })
}

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Pronounce French text. Slightly slowed down for learning. */
export function speak(text: string, rate = 0.9): void {
  if (!speechAvailable()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'fr-FR'
  if (!frVoice) frVoice = pickVoice()
  if (frVoice) utterance.voice = frVoice
  utterance.rate = rate
  window.speechSynthesis.speak(utterance)
}
