import type { SeedFile } from '../types'
import type { VocabRepo } from './VocabRepo'
import { ApiRepo } from './ApiRepo'
import { LocalStorageRepo } from './LocalStorageRepo'
import seedJson from '../data/words.json'

/** AWS backend when VITE_API_URL is configured, offline localStorage otherwise. */
export function createRepo(): VocabRepo {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) return new ApiRepo(apiUrl.replace(/\/$/, ''), (import.meta.env.VITE_API_KEY as string) ?? '')
  return new LocalStorageRepo(seedJson as SeedFile)
}
