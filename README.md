# av-website

Personal site of Anton Veselskyi.

- `index.html` — the landing page.
- `french-app/` — **Mon français**: a personal French-vocabulary learning app (React + Vite + TS).
- `infra/` — AWS backend for the vocab app (SAM: DynamoDB + Lambda + HTTP API).
- `.claude/skills/add-word/` — Claude Code skill that adds new words to the dictionary.

## Mon français

An Obsidian-styled dictionary of every French word I know, curated for a Ukrainian speaker:
each card shows FR/EN/UK translations, IPA **and** Ukrainian-Cyrillic transcription, examples
in all three languages, confidence % and how I learned it.

| Page | What it does |
|---|---|
| 📖 Dictionary | card grid, search (fr/en/uk), topic filters |
| 🕸️ Graph | Obsidian-style force graph — topics as cluster hubs, brightness = confidence |
| 🏆 Achievements | per-topic completion % with Bronze/Silver/Gold tiers |
| 🎓 Learn | flashcards by topic or "15 most recent words" |
| 📝 Test | choice / typing / listening quizzes on recent, topic or random words, with audio |
| ➕ Add word | in-app form (or use the `/add-word` Claude skill) |

Pronunciation audio uses the browser's speech synthesis (French voice) — no server needed.

### Develop

```sh
cd french-app
npm install
npm run dev        # http://localhost:5173/french-app/
npm test           # vitest: confidence algorithm, quiz engine, storage, seed validation
npm run build
npm run validate-words   # check src/data/words.json after hand edits
```

Without configuration the app runs fully offline: words come from
`french-app/src/data/words.json`, your progress lives in localStorage.

### Adding words with Claude

Run `/add-word le chien` in Claude Code. The skill generates translations (EN/UK), IPA +
Cyrillic transcription, A1 example sentences, picks a topic, keeps the JSON sorted and runs
the validator. See `.claude/skills/add-word/SKILL.md`.

### Deploy the AWS backend (optional)

```sh
cd infra
sam build
sam deploy --guided        # first time; pass ApiKey=$(openssl rand -hex 24)
node ../french-app/scripts/seed-remote.mjs <ApiUrl output> <your api key>
```

Then copy `french-app/.env.example` to `french-app/.env.local`, fill in `VITE_API_URL` and
`VITE_API_KEY`, and rebuild. The ribbon shows **AWS** instead of **LOCAL** when the backend
is active. Words and progress then live in DynamoDB (single `french-vocab` table,
pay-per-request — effectively free at personal scale).

### Deploy the app

`npm run build` produces a static `french-app/dist/` (built with base `/french-app/`), so it
can be hosted next to the landing page on any static host (S3 + CloudFront, GitHub Pages, …).
