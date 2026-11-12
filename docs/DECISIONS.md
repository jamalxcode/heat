# Decisions

Why the project works the way it does. Add new decisions at the end, and keep each one in step with the code.

## Prediction markets: how often data is fetched

*Written up on 12 Nov 2026 after the question "how many times are we getting data for the prediction markets?" The answer, worked out from the code at that point, is below.*

**Answer:** every 10 minutes, about **144 times a day**. Each fetch is one run of `.github/workflows/update-data.yml`, which runs `scripts/build-predictions.mjs` in the background (240 s timeout) while the other markets build.

### 1. One shared 10-minute cycle for every market
**Decision:** prediction markets ride the same deploy job as crypto, forex, metals and the rest, instead of having their own workflow.
- One job, one Pages deploy, one set of timers to keep alive.
- Prediction prices move faster than daily candles but slower than a live ticker. Ten minutes is fresh enough for "most traded questions", and the page says "not real-time, every 10 min".

### 2. cron-job.org starts the runs; GitHub's schedule is the backup
**Decision:** cron-job.org dispatches the workflow every 10 minutes. GitHub's own schedule (`7-59/10 * * * *`) stays on as a backup.
- GitHub's schedules proved unreliable (about 1 run in 15 actually ran).
- The workflow's concurrency group (`pages`, `cancel-in-progress: false`) queues runs that overlap instead of running them in parallel, so the extra timer doesn't double the fetches.
- Pushes to `main` and manual runs also fetch once each.

### 3. What each venue fetches per run
| Venue | Every run (10 min) | Less often |
|---|---|---|
| Polymarket | Top 120 events by 24 h volume (changes come with the data) | Price-history backfill: up to 80 markets per run, each at most once a day |
| Kalshi | Refresh of the 120 most traded events | Full scan of 12,000+ open events **once an hour** (`KALSHI_SCAN_EVERY`, stops paging after 150 s). Daily-candle backfill: up to 40 markets per run, each at most once a day |
| PredictIt | The whole public feed in one call (top 80 kept) | — |
| Manifold | Top 100 open markets | — |
| Betfair | Politics markets by money matched (top 60) | Only runs when the `BETFAIR_*` secrets are set |

### 4. Kalshi's full list is scanned hourly, not every run
**Decision:** a full scan takes about 2–2.5 minutes and is mostly tiny local races. Scanning it every 10 minutes would use most of the job's time limit for little gain. The hourly scan finds the event list, and the runs in between refresh only the 120 most traded events.

### 5. Backfill is capped and once a day per market
**Decision:** missing daily history is filled from the venues' own past prices (Kalshi's daily candles, Polymarket's price history), but at most 80 Polymarket and 40 Kalshi markets per run, with 4 and 2 requests at a time, and each market at most once a day. The 1w / 1m changes and the popup chart fill in within the first hours without hammering the venues.

### 6. Visitors never call the venues
**Decision:** browsers only read `predictions.json` from the site. The page checks for a newer copy every 30 seconds and reloads it once it is more than the refresh interval old. Visitor traffic adds no requests to Polymarket, Kalshi, PredictIt, Manifold or Betfair.

### 7. A failure never empties a tab
**Decision:**
- A venue that fails keeps its markets from the last published file, marked stale (the tile says "⚠ not refreshed").
- If the whole build fails or times out, the last `predictions.json` is republished.
- The previous file comes in through `PREV_URL`, which also carries the daily history and Kalshi's event list between runs.

### 8. Predictions are in the hourly freshness check
**Decision:** `scripts/check-fresh.mjs` fails (and GitHub emails) when `predictions.json` hasn't been built for an hour, or when a venue has been stale for more than a day, or has an empty tab (`down`). A venue that isn't set up (`off`, Betfair without its secrets) never alerts. Before this, a prediction build that stayed stale went unnoticed, because the build republishes the last file and the job still "succeeds".

## Prediction tiles: less empty space

*12 Nov 2026, from a screenshot of the live page on a laptop: big tiles were mostly empty.*

### 9. Content stacks under the title
**Decision:** a tile's answer and chance sit right under its question, and only the footer (time left, total bet) is pushed to the bottom. Before, the answer was pinned to the bottom, so a tile stretched to match a taller neighbour showed a big hole between the question and the answer.

### 10. A 2×2 tile has to have something to fill it
**Decision:** the top few questions get a 2×2 tile only when they have a top-three race or related questions to show. A lone yes/no in that place gets a wide (2×1) tile instead (`sizes()` in `app/predictions.mjs`).

### 11. Money bet today goes in the header
**Decision:** the amount bet in the last 24 hours is a chip beside the rank ("#4 · $4.7M today"; just "$4.7M" on small tiles, with "today" in the tooltip). It's the first thing read after the rank, and the footer keeps only the time left and the total. Big tiles use smaller type (36px chance, 21px question, 40px icon instead of 54, 27 and 60).
