# CLAUDE.md

Guidance for Claude Code sessions working in this repository.

## What this repo is

Personal site of Anton Veselskyi (Ukrainian native speaker, beginner/A1 in French):

- `index.html` — static landing page. **Do not touch** unless explicitly asked.
- `french-app/` — **Mon français**: personal French-vocabulary learning SPA (Vite + React + TypeScript, Obsidian-style dark UI). This is where nearly all work happens.
- `infra/` — AWS backend for the app (SAM: DynamoDB `french-vocab` table + one Lambda + HTTP API, x-api-key auth). Optional; the app runs fully offline without it.
- `.claude/skills/` — `add-word` and `add-topic` skills for growing the dictionary. **Prefer these flows over ad-hoc edits** when the user asks to add vocabulary or categories.

Main branch for this work: `claude/french-learning-platform-zolsd5` (site default branch is `master`).

## Commands (run from `french-app/`)

```sh
npm run dev              # dev server → http://localhost:5173/french-app/
npm test                 # vitest (confidence, quiz, storage, seed validation)
npm run build            # tsc -b && vite build → dist/ (static, base /french-app/)
npm run validate-words   # REQUIRED after any edit to src/data/words.json
```

## The data contract (most important thing to know)

`french-app/src/data/words.json` is the **single source of vocabulary content**, shared by:
the app (bundled import), both Claude skills (direct file edits), and
`scripts/seed-remote.mjs` (pushes it to DynamoDB). Its shape is `SeedFile` in
`french-app/src/types.ts`: `{ version: 1, topics: Topic[], words: Word[] }`.

Content rules:
- Sorted by `topic` (alphabetical), then by `fr` within a topic. Topics array sorted by `id`. 2-space indent.
- Word `id` = ASCII slug of the French word **without the article** (`"le chien"` → `"chien"`, `"s'il te plaît"` → `"sil-te-plait"`). Nouns keep their article in `fr` (gender matters for learning).
- Every word AND every example needs `ipa` and `cyr` (Ukrainian-Cyrillic transcription). Transcription conventions + few-shot anchors live in `.claude/skills/add-word/SKILL.md` — follow them exactly.
- `en`/`uk` are arrays; Ukrainian must be natural modern Ukrainian, never russism calques.
- Examples are A1 level (present tense, 3–8 words), fields `fr`/`en`/`uk`/`ipa`/`cyr` all required.
- Always finish with `node scripts/validate-words.mjs` (also enforced by `src/seed.test.ts`).

**Content vs progress separation**: learning progress (confidence %, timesCorrect/Wrong,
learnedAt) NEVER goes into words.json. It lives in localStorage keys `fr.progress`,
`fr.words.overrides`, `fr.words.deleted` (or DynamoDB `pk=PROGRESS` when the API is used).
Editing/re-seeding content therefore never clobbers the user's progress.

## Architecture map (french-app/src/)

- `types.ts` — Word / Example / Topic / WordProgress / SeedFile / ReviewEvent. The whole contract.
- `storage/` — `VocabRepo.ts` (interface), `LocalStorageRepo.ts` (bundled seed + localStorage
  overlay merge; default), `ApiRepo.ts` (AWS), `createRepo.ts` (factory: `VITE_API_URL` set → API,
  else local), `RepoContext.tsx` (provider + the `useVocab()` hook every page uses).
- `lib/` — pure, unit-tested logic:
  - `confidence.ts` — `applyResult` (per-event deltas, clamp 0–100), `MASTERED_AT = 80`
    (drives achievements + `learnedAt`), `effectiveConfidence` (−2/week display decay, never persisted).
  - `quiz.ts` — question building (choice/typing/listening), weighted word picking
    (low effective confidence = picked more), `checkTypedAnswer` (diacritics/apostrophe/article tolerant).
  - `achievements.ts` — per-topic completion % and Bronze/Silver/Gold tiers.
  - `speech.ts` — SpeechSynthesis fr-FR wrapper (audio is free, browser-side).
- `pages/` — Dictionary (`/`), Graph (`/graph`), Achievements, Learn, Test, WordForm (`/word/new`, `/word/:id/edit`).
- `components/` — WordCard, WordModal (shared by Dictionary + Graph), ConfidenceBar, SpeakButton, TopicBadge.
- `styles/theme.css` — the only stylesheet; Obsidian palette via CSS custom properties. No CSS framework.

New topics/words need **zero code changes** — the graph, achievements, filters and quizzes are all
data-driven from words.json.

## Gotchas

- tsconfig has `erasableSyntaxOnly` — **no constructor parameter properties** (`constructor(private x…)` breaks the build); declare fields explicitly.
- Graph uses `react-force-graph-2d` (standalone package — do not swap in the `react-force-graph` umbrella, it drags in three.js).
- Routing is `HashRouter` and Vite `base` is `/french-app/` — dev/preview URLs are `…/french-app/#/route`.
- `infra/src/handler.mjs` uses the AWS SDK v3 **from the Lambda runtime** — don't add it to any package.json. No build step for the Lambda.
- Cloud sessions have no `sam`/`aws` CLI: check the handler with `node --check`, leave real `sam validate`/`deploy` to Anton (steps in README.md).
- Browser-verification pattern that works here: build + `npm run preview -- --port 4173`, then drive
  with `playwright-core` using executablePath `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  (check the exact versioned dir under `/opt/pw-browsers/`).

## Verification bar for changes

`npm test` green + `npm run build` clean is the minimum. For UI changes, actually load the pages
(preview + Playwright screenshots) — every page should render with zero console errors. For data
changes, `npm run validate-words`.
