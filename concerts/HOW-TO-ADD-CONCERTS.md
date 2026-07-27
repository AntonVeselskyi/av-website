# How to add a concert

All concert data lives in **`concerts/index.html`**, in the JavaScript array
`const concerts = [ … ]` (starts ~line 1155). Everything on the page is rendered
from that array — you never touch the HTML/CSS, just add an object.

## 1. Where & ordering
- Newest first. A new show goes at the **top** of the array (right after
  `const concerts = [`), because the timeline sorts by position.
- Each entry is a plain object. Copy the template below, fill it in, done.

## 2. Concert object — fields

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
| `notes` | ✅ | freeform, e.g. `"w. Djo. Tour · 8:50–10:55 PM set. Photos to come!"` |
| `supports` | ✅ | array of support-act objects (`[]` if none) — same shape, see §6 |
| `logoInvert` | optional | `true` if the logo art is dark and needs inverting on the cream page |
| `nameStyle` | optional | `"serif"` \| `"cond"` \| `"didone"` — font style for the **name banner** when there's no logo |
| `setlistSpotify` | optional | `{ "Song": "spotifyTrackId" }` — makes each song a playable Spotify link |
| `setlistYTMusic` | optional | `{ "Song": "youtubeVideoId" }` — playable YouTube links |

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
  (Tame Impala uses `cond`, Djo uses `serif` — neither has a logo file.)

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
  "notes": "w. Opener. Tour · 8:00–10:00 PM set. Photos to come!",
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
