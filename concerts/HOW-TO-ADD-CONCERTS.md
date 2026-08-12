# How to add a concert

All concert data lives in **`concerts/index.html`**, in the JavaScript array
`const concerts = [ … ]` (starts ~line 1155). Everything on the page is rendered
from that array — you never touch the HTML/CSS, just add an object.

## 1. Where & ordering
- Newest first. A new show goes at the **top** of the array (right after
  `const concerts = [`), because the timeline sorts by position.
- Each entry is a plain object. Copy the template below, fill it in, done.

## 2. Concert object — fields

> Adding a **game/match** rather than a gig? Skip to **§6.5 Sports events** —
> those entries render a scoreboard and use a different field set.

| field | required | what it is |
|---|---|---|
| `id` | ✅ | unique slug: `artist-city-YYYY-MM-DD`, e.g. `tame-impala-toronto-2026-07-26` |
| `artist` | ✅ | headliner name |
| `tourName` | ✅ | e.g. `"Deadbeat Tour"` |
| `date` | ✅ | display string, e.g. `"Sun · Jul 26, 2026"` |
| `isoDate` | ✅ | `"2026-07-26"` (used for sorting) |
| `venue` | ✅ | e.g. `"Scotiabank Arena"` |
| `city` | ✅ | e.g. `"Toronto, ON"` |
| `setlist` | ✅ | array of song strings **in play order** |
| `photos` | ✅ | array of image paths (start `[]`; see §5) |
| `logo` | ✅ | `"pics/logos/name.png"` **or** `""` (empty → styled name banner, see §4) |
| `spotifyEmbed` | ✅ | embed URL, `""` if none (see §3) |
| `notes` | ✅ | freeform, e.g. `"w. Djo. Tour · 8:50–10:55 PM set."` |
| `supports` | ✅ | array of support-act objects (`[]` if none) — same shape, see §6 |
| `logoInvert` | optional | `true` if the logo art is dark and needs inverting on the cream page |
| `nameStyle` | optional | `"serif"` \| `"cond"` \| `"didone"` — font style for the **name banner** when there's no logo |
| `setlistSpotify` | **see §3.5** | `{ "Song": "spotifyTrackId" }` — per-song Spotify link icon |
| `setlistYTMusic` | **see §3.5** | `{ "Song": "youtubeVideoId" }` — **required for clickable songs + the playlist buttons** |

## 3. Spotify embed
Spotify → the artist (or album/playlist/track) → **Share → Embed → Copy** the
`src` URL. It looks like:
```
https://open.spotify.com/embed/artist/5INjqkS1o8h1imAzPqGZBb?utm_source=generator
```
The middle chunk is the artist ID. **Verify the ID is the right artist** (a wrong
ID silently embeds the wrong band). Fastest check: open
`https://open.spotify.com/artist/<ID>` and confirm the name. `artist/`,
`album/`, `playlist/`, and `track/` embeds all work.

## 3.5 ⚠️ Per-song IDs — don't skip these
A bare `setlist` of strings renders as **plain, dead text**: songs aren't
clickable, and the **"Play setlist" / "Open on YouTube" buttons don't appear at
all.** Those come *only* from **`setlistYTMusic`**:

- `setlistYTMusic` → makes each song `.playable` (click = plays in the inline
  player) **and** creates both playlist buttons. The "Open on YouTube" link is
  built as `watch_videos?video_ids=…` from these IDs, in setlist order.
- `setlistSpotify` → adds the per-song Spotify icon linking to that exact track.

**The map keys must match the `setlist` strings character-for-character** (same
apostrophes, capitalisation, punctuation) or that song silently stays dead.

Getting the IDs:
- **YouTube:** web-search `Artist "Song" official audio youtube.com/watch` and
  take the 11-char `v=` value. Prefer the artist's official audio/video; avoid
  live/remix/lyric re-uploads unless that's what you want.
- **Spotify:** `kworb.net/spotify/artist/<artistId>_songs.html` lists a whole
  artist's tracks with IDs in one page — much faster than one-by-one.

A song with no ID still renders fine (it just falls back to a YouTube *search*
link and isn't part of the inline playlist), so partial coverage is OK — e.g.
unreleased live jams that have no official upload.

Quick self-check in the browser console after adding:
```js
const b = concerts.find(c => c.id === 'your-id');           // or a supports[n]
const set = new Set(b.setlist);
Object.keys(b.setlistYTMusic).filter(k => !set.has(k));      // [] = no typos
b.setlist.filter(s => !b.setlistYTMusic[s]);                 // songs left dead
```

## 4. Logos
- **Preferred:** drop a file in `concerts/pics/logos/` (svg or png) and set
  `"logo": "pics/logos/name.png"`. Add `"logoInvert": true` if the logo is dark
  (the page background is cream `#f4ede0`).
- **No logo art?** Leave `"logo": ""` and set `"nameStyle"` — the artist's **name**
  is drawn as a styled wordmark instead:
  - `"cond"` — big heavy condensed (good for a headliner)
  - `"serif"` — elegant serif
  - `"didone"` — high-contrast Didone
  - omit for the plain default
  (Tame Impala uses its official stacked logo; Djo uses `serif`.)

## 5. Photos
Start with `"photos": []`. When you have shots, drop them in `concerts/pics/`
and list the paths, e.g. `"photos": ["pics/tame-impala-1.jpg", "pics/tame-impala-2.jpg"]`.

## 6. Support acts (`supports`)
Each opener/support is an object with the **same** fields as a concert, minus the
top-level show info. Ordered **highest bill first** (direct support before opener):
```js
"supports": [
  {
    "artist": "Djo",
    "role": "opener",              // "opener" | "co-headliner" | "support"
    "nameStyle": "serif",          // or a "logo": "pics/logos/djo.png"
    "spotifyEmbed": "https://open.spotify.com/embed/artist/5p9HO3XC5P3BLxJs5Mtrhm?utm_source=generator",
    "setlist": ["Awake", "Change", "…"],
    "notes": "Special guest · 7:15–8:00 PM set"
  }
]
```

## 6.5 Sports events (the **Sports** tab)

Set `"category": "sports"` and the entry renders a **scoreboard instead of a
band panel** — no Spotify embed, no "Get familiar with the band", no setlist.
(Category is otherwise auto-detected; only ids starting with `raptors` fall into
sports on their own.) A sports entry needs: `id`, `artist`, `tourName`, `date`,
`isoDate`, `venue`, `city`, `category`, `notes`, `photos`, `logo` — plus a
`game` object, and optionally a `ticket` object. `setlist` / `spotifyEmbed` /
`supports` are ignored, so leave them out.

### `game` — the scoreboard
Nothing in it is basketball-specific; the **column labels come from the data**,
so the same panel does NBA quarters, a Dota Bo5, or tennis sets:

| field | what it is |
|---|---|
| `home` / `away` | `{ team, abbr, logo, score, line: [...], win: true\|false, flag }` |
| `periods` | column headers for the line score — `["1","2","3","4"]` (default), `["G1","G2","G3"]`, `["S1","S2","S3"]` |
| `line` (per team) | one value per column: points, or `"W"`/`"L"` for a series |
| `finalLabel` | last column header — `"F"` (default), `"S"` for a series |
| `lineLabel` | left-column heading — `"Line Score"` (default), `"Series"` |
| `leadersLabel` | right-column heading — `"Top Performers"` (default), `"Rosters"` |
| `leadersHome` / `leadersAway` | `[{ name, line }]` — stat line, or a position for a roster. Omit both and the right column disappears |
| `format` | small caps line under the score, e.g. `"Grand Final · Best of 5"` |
| `statusLabel` | replaces `FINAL` in the tag line |
| `nameStyle` | font for the drawn wordmarks — `"didone"` \| `"serif"` \| `"cond"`, blank = blackletter |
| `notes` | text under the line score (a single-match `game` falls back to the entry's `notes`) |
| `matches` | **several results on one ticket** — see below |
| `status` | `"upcoming"` → see below |

### One ticket, several results
A session ticket often covers more than one match. Put them in `matches`, an
array of objects each carrying its own `home`/`away`/`periods`/`leaders*`/
`notes`/`format`, plus a `label` for the small heading above the face-off
(`"Main event"`, `"Earlier on centre court"`). Anything set on `game` itself
(`nameStyle`, `lineLabel`, `finalLabel`, `leadersLabel`, `periods`) is the
default for every match in the list.

**Order by what the evening meant, not by order of play** — the headline result
goes first, and the label says where it actually sat on the schedule. Only the
first block repeats the venue and date in its tag line.

A `game` with `home`/`away` straight on it is treated as a one-match list, which
is why the Raptors entries never changed.

`logo` per team is a URL **or** a local `pics/logos/x.png`. Leave it `""` and
the team's `abbr` is drawn as an ink wordmark instead (that's what TL / GG / OG
and the tennis surnames do — no free logo art exists for esports orgs, and
tennis has no team crests). The wordmark auto-shrinks past 4 and 8 characters,
so a surname like `ŚWIĄTEK` still fits beside its opponent. Broken logo URLs
fall back to the same wordmark automatically. `quarters` is still read as an
alias for `line`, which is why the old Raptors entries keep working.

Sports that aren't team-vs-team map on fine: for **tennis**, `home`/`away` are
the two players (put the seed in `team`, the surname in `abbr`), `periods` are
the sets, `line` the games in each set, `score` the sets won, and `leaders*`
becomes a stat table (`{ name: "Unforced errors", line: "8" }`) under
`leadersLabel: "Match Stats"`. Set `"nameStyle": "didone"` on the `game` so the
names are set in the Bodoni rather than the blackletter.

### Flags
`"flag": "ua"` on a team/player draws a small flag beside the wordmark and
beside their name in the stat column. Flags are **drawn as SVG, not emoji** —
Windows renders regional-indicator emoji as bare letter pairs, so they'd show up
as "UA" on half the machines that visit. Add new ones to the `FLAGS` map next to
`flagSVG()` as `[topBandColour, bottomBandColour]`; anything other than a simple
two-band flag needs its own SVG.

Flags are **opt-in per player, and deliberately not on everyone** — the ones
present are there because they mean something.

### Upcoming events
A ticket bought before the match has no result. Set
`"game": { "status": "upcoming", "round": "…", "matchup": "…" }` and the panel
shows the round + matchup + ticket stub instead of a score. Once it's played,
delete `status`/`matchup` and fill in `home`/`away` as above.

### `ticket` — the seat, drawn as a paper stub
Optional on any event, past or upcoming:
```js
"ticket": {
  "gate": "West", "level": "Level 100",
  "section": "135", "row": "K", "seats": "5–6",
  "time": "7:00 PM"
}
```

### Sports template
```js
{
  "id": "team-city-2026-01-01",
  "artist": "Toronto Raptors",
  "tourName": "vs. Miami Heat",
  "date": "Wed · Jan 1, 2026",
  "isoDate": "2026-01-01",
  "venue": "Scotiabank Arena",
  "city": "Toronto, ON",
  "category": "sports",
  "photos": [],
  "logo": "https://a.espncdn.com/i/teamlogos/nba/500/tor.png",
  "notes": "How the game went.",
  "game": {
    "periods": ["1", "2", "3", "4"],
    "home": { "team": "Toronto Raptors", "abbr": "TOR", "logo": "…", "score": 103, "line": [32,34,18,19], "win": false },
    "away": { "team": "Miami Heat",      "abbr": "MIA", "logo": "…", "score": 112, "line": [37,27,23,25], "win": true },
    "leadersHome": [{ "name": "Pascal Siakam", "line": "30 PTS · 6 AST · 4 REB" }],
    "leadersAway": [{ "name": "Caleb Martin",  "line": "24 PTS · 12 REB" }]
  }
}
```

NBA logos: `https://a.espncdn.com/i/teamlogos/nba/500/<abbr>.png` (lowercase).

### Event / org logos
The top-level `logo` is the **organiser's** mark (the tournament, the league) —
`pics/logos/national-bank-open.png`, `ti2024.png`. Grab it from the official
site and check you took the version made for a **light** background: vendors
usually ship both, and the file is often named for the background it sits on,
not its own colour (`NBO-Light.png` is the dark-ink one). Sanity-check the
average brightness before committing, or just look at it on the cream page —
a white logo vanishes. If only a dark-background version exists, keep it and
set `"logoInvert": true`.

## 7. Finding the setlist
Use **setlist.fm** (search the exact venue + date). Tip: the site's own search
snippets are often cached/stale and say "empty" — open the actual setlist page to
read the real songs and set times. Concert times/support order are usually on the
same page.

## 8. Full copy-paste template
```js
{
  "id": "artist-city-2026-01-01",
  "artist": "Artist Name",
  "tourName": "The Tour",
  "date": "Fri · Jan 1, 2026",
  "isoDate": "2026-01-01",
  "venue": "Venue Name",
  "city": "Toronto, ON",
  "setlist": [
    "Song One",
    "Song Two"
  ],
  "photos": [],
  "logo": "",
  "nameStyle": "cond",
  "spotifyEmbed": "https://open.spotify.com/embed/artist/XXXX?utm_source=generator",
  "notes": "w. Opener. Tour · 8:00–10:00 PM set.",
  "supports": [
    {
      "artist": "Opener",
      "role": "opener",
      "nameStyle": "serif",
      "spotifyEmbed": "https://open.spotify.com/embed/artist/YYYY?utm_source=generator",
      "setlist": ["Their Song One", "Their Song Two"],
      "notes": "Opening act · 7:00–7:40 PM set"
    }
  ]
},
```

## 9. Preview locally
Serve the folder and open the page (any static server works):
```bash
python -m http.server 5500      # from C:\code\av-website
```
Open `http://localhost:5500/concerts/index.html`, find your card, and check the
setlist + embeds render and the console is clean.

## 10. Deploy (commit + push)
Static site on the **`gh-pages`** branch of GitHub Pages — no build step. This
file (`concerts/index.html`) is **not** version-stamped (unlike the game/show
list pages with `?v=`), so no cache-bust bump is needed; GitHub Pages just serves
it (browsers may hold the old copy for ~10 min).

```bash
git add concerts/index.html
git commit -m "concerts: add <Artist> (<venue> <date>)" -- concerts/index.html
```

**Pushing:** the `origin` remote is **SSH**, and only **WSL** has the SSH key
(Git Bash on Windows does not) — so push from WSL:
```bash
wsl bash -lc 'cd /mnt/c/code/av-website && git push origin gh-pages'
```
If the push is rejected as *non-fast-forward*, the branch has diverged from work
pushed elsewhere — `git fetch` then `git merge origin/gh-pages` (or pull) and
resolve before pushing again. **Never `--force`** — it would wipe remote work.
