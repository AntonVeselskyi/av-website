---
name: add-topic
description: Add a new topic (category / cluster) to the personal French vocabulary app, e.g. "/add-topic animals" or "create a category for travel words". Also use when /add-word finds no fitting topic for a word.
---

# Add a topic (category) to the vocabulary

Topics are the clusters in the graph view, the achievement rows, and the filter chips of
`french-app/`. They live in the `topics` array of `french-app/src/data/words.json` and are pure
data — **no code changes are ever needed** for a new topic; the graph, achievements and filters
pick it up automatically.

## Steps

1. **Read** `french-app/src/data/words.json` and look at the existing topics.

2. **Check for overlap.** If the requested category substantially overlaps an existing one
   (e.g. "kitchen" vs `food`, "furniture" vs `home`), tell the user and ask whether they really
   want a separate topic or would rather file words under the existing one.

3. **Generate the Topic entry:**
   - `id` — short ASCII slug, singular concept: `"animals"`, `"travel"`, `"body"`.
   - `nameEn` — Title Case English name: `"Animals"`, `"Travel & Transport"`.
   - `nameUk` — natural Ukrainian name: `"Тварини"`, `"Подорожі та транспорт"`.
   - `emoji` — one emoji not used by another topic.
   - `color` — hex `#rrggbb`, **visually distinct from every existing topic color** (it drives the
     graph cluster and badges on a `#1e1e1e` background, so keep it mid-to-bright).
     Colors already taken by the starter topics:
     `#d0a35c` (adjectives), `#e05cd0` (colors), `#f58a5c` (family), `#f5c95c` (food),
     `#8a5cf5` (greetings), `#5cc9f5` (home), `#5c9ef5` (numbers), `#f55c8a` (questions),
     `#5cd6a8` (time), `#7dc86c` (verbs) — plus any topics added since; always check the file.
     Good free hues to reach for: teal `#5cf5e0`-ish, deep orange `#f57a3d`-ish, lavender
     `#b58af5`-ish, lime `#c8e05c`-ish.

4. **Insert** into the `topics` array keeping it sorted alphabetically by `id`. 2-space indent.

5. **Words for the topic:**
   - If the user named existing words to move, change their `topic` field and reposition them so
     the `words` array stays sorted by `topic`, then `fr`.
   - If the user wants new words in the category, follow the `add-word` skill for each
     (`.claude/skills/add-word/SKILL.md`).
   - An empty topic is fine too — it shows as 0/0 in achievements and a lone hub in the graph.

6. **Validate**: run `node french-app/scripts/validate-words.mjs` and fix anything it reports
   (it checks topic id uniqueness, color format, and that every word's `topic` exists).

7. **Confirm** to the user: show the new topic line (emoji, nameEn, nameUk, color) and which
   words (if any) were added or moved.
