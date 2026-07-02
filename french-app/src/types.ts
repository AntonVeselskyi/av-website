/** An example sentence in all three languages, with transcriptions of the French. */
export interface Example {
  /** French sentence, e.g. "Bonjour, comment ça va ?" */
  fr: string
  /** English translation */
  en: string
  /** Ukrainian translation */
  uk: string
  /** IPA transcription of the French sentence */
  ipa: string
  /** Ukrainian-Cyrillic transcription, e.g. "бонжур, коман са ва" */
  cyr: string
}

export interface Word {
  /** Slug of the French word: "bonjour", "sil-vous-plait" */
  id: string
  fr: string
  /** English translations (usually 1–2) */
  en: string[]
  /** Ukrainian translations */
  uk: string[]
  /** IPA, e.g. "/bɔ̃.ʒuʁ/" */
  ipa: string
  /** Ukrainian-Cyrillic transcription, e.g. "бонжур" */
  cyr: string
  /** Topic.id this word belongs to */
  topic: string
  examples: Example[]
  /** "How I learned it" — free-form source note */
  source?: string
  /** ISO date, e.g. "2026-07-02" */
  addedAt: string
}

export interface Topic {
  /** "food", "greetings" */
  id: string
  nameEn: string
  nameUk: string
  /** Used in achievements list and as the graph cluster hub label */
  emoji: string
  /** Hex color driving graph cluster + badge color */
  color: string
}

export interface SeedFile {
  version: 1
  topics: Topic[]
  words: Word[]
}

/** User progress — deliberately separate from content. */
export interface WordProgress {
  wordId: string
  /** 0–100, starts at 0 */
  confidence: number
  timesCorrect: number
  timesWrong: number
  /** ISO datetime of the last learn/test interaction */
  lastReviewedAt?: string
  /** Set the first time confidence crosses the "mastered" threshold (80) */
  learnedAt?: string
}

export type ReviewEvent =
  | 'learn-knew'
  | 'learn-didnt'
  | 'quiz-choice-correct'
  | 'quiz-typing-correct'
  | 'quiz-listening-correct'
  | 'quiz-wrong'
