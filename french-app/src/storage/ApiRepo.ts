import type { Topic, Word, WordProgress } from '../types'
import type { VocabRepo } from './VocabRepo'
import seed from '../data/words.json'

/**
 * AWS-backed repository. Talks to the HTTP API deployed from infra/template.yaml.
 * Topics still come from the bundled seed file (they change rarely and travel
 * with the app); words and progress are server truth.
 */
export class ApiRepo implements VocabRepo {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as T
  }

  async getTopics(): Promise<Topic[]> {
    return (seed as { topics: Topic[] }).topics
  }

  async getWords(): Promise<Word[]> {
    return this.request<Word[]>('GET', '/words')
  }

  async saveWord(word: Word): Promise<void> {
    await this.request('PUT', `/words/${encodeURIComponent(word.id)}`, word)
  }

  async deleteWord(id: string): Promise<void> {
    await this.request('DELETE', `/words/${encodeURIComponent(id)}`)
  }

  async getAllProgress(): Promise<Record<string, WordProgress>> {
    const list = await this.request<WordProgress[]>('GET', '/progress')
    return Object.fromEntries(list.map((p) => [p.wordId, p]))
  }

  async saveProgress(progress: WordProgress): Promise<void> {
    await this.request('PUT', `/progress/${encodeURIComponent(progress.wordId)}`, progress)
  }
}
