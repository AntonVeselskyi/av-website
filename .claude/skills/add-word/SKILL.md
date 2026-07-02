---
name: add-word
description: Add a French word or phrase to the personal vocabulary app (french-app). Use when the user gives a French word to add, e.g. "/add-word fromage" or "add the word 'le chien' to my dictionary".
---

# Add a French word to the vocabulary

You are adding an entry to `french-app/src/data/words.json` — the seed dictionary of a personal
French-learning app for Anton, a Ukrainian native speaker at A1 level.

## Steps

1. **Read** `french-app/src/data/words.json`. Note the existing `topics` (with their ids) and words.

2. **Check for duplicates.** Normalize the input the way the validator does: lowercase, strip a
   leading article (le/la/les/l'/un/une/des), strip diacritics, collapse apostrophes/hyphens/spaces.
   If a word with the same normalized French headword already exists, tell the user and ask whether
   they want to update the existing entry instead. Never create a duplicate.

3. **Generate the entry** with these fields:
   - `id` — ASCII slug of the French word without the article: `"le chien"` → `"chien"`,
     `"s'il te plaît"` → `"sil-te-plait"`.
   - `fr` — the word with its article for nouns (`"le chien"`), bare for other parts of speech.
   - `en` — 1–2 natural English translations.
   - `uk` — 1–2 natural Ukrainian translations. Use proper modern Ukrainian, never russism calques.
   - `ipa` — IPA in slashes, with syllable dots: `"/ʃjɛ̃/"`.
   - `cyr` — Ukrainian-Cyrillic transcription (conventions below).
   - `topic` — the best-fit **existing** topic id. Only propose a brand-new topic if nothing fits,
     and confirm with the user first (a new topic needs `id`, `nameEn`, `nameUk`, `emoji`, unique
     `color` in `#rrggbb`).
   - `examples` — 2 short A1-level example sentences. Each example has all 5 fields:
     `fr`, `en`, `uk`, `ipa` (of the French sentence), `cyr` (of the French sentence).
   - `source` — ask the user how they learned the word if they didn't say; otherwise use their
     wording (e.g. "Duolingo unit 4", "heard in a boulangerie"). Default: "added via /add-word".
   - `addedAt` — today's date, `YYYY-MM-DD`.

4. **Insert** the entry keeping the file sorted by `topic` (alphabetically), then by `fr` within
   the topic. Keep 2-space indentation.

5. **Validate**: run `node french-app/scripts/validate-words.mjs` and fix anything it reports.

6. **Confirm** to the user by rendering the card: the word, both transcriptions, translations,
   and examples — so they can spot mistakes immediately.

## Ukrainian-Cyrillic transcription conventions (`cyr` fields)

Reflect real French pronunciation, not spelling. Silent final consonants and silent endings are
dropped. Stress always falls on the final syllable, no stress mark needed.

| French sound | Cyrillic | Example |
|---|---|---|
| /y/ (u) | ю | tu → тю, salut → салю |
| /ø/, /œ/ (eu) | ьо after consonant / е | deux → дьо, sœur → сер |
| /ə/ | е | je → же, petit → петі |
| /ɑ̃/, /ɛ̃/ + other nasals | ан / ен / он (keep н) | grand → ґран, vin → вен, bon → бон |
| /œ̃/ (un) | ен | un → ен, lundi → ленді |
| /ʁ/ | р | rouge → руж |
| /ʒ/ | ж | bonjour → бонжур |
| /ɡ/ | ґ (not г) | gare → ґар |
| /w/ (oi = /wa/) | уа | trois → труа, noir → нуар |
| /ɥ/ (ui) | юі | huit → юіт, aujourd'hui → ожурдюі |
| /j/ | й / ь + vowel | fille → фій, bien → бьєн |
| final /l/ after i | ль | facile → фасіль |
| /ɛ/, /e/ | е | café → кафе |
| /o/, /ɔ/ | о | beau → бо |

Few-shot anchors: bonjour → бонжур · s'il vous plaît → сіль ву пле · au revoir → о ревуар ·
je m'appelle → же мапель · fromage → фромаж · cuisine → кюізін · grand-mère → ґран-мер ·
vingt → вен · vouloir → вулуар · comment ça va → коман са ва.

For sentence `cyr`, transcribe the whole French sentence with liaisons where natural
(vous avez → ву заве) and keep punctuation.

## Example-sentence guidelines

- A1 level: present tense, common vocabulary, 3–8 words.
- Prefer sentences that reuse other words already in the dictionary.
- Make at least one example personally relevant when possible (Anton, Ukrainian, coffee,
  work, learning French).
