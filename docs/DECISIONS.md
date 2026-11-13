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

## The whole site

*Written up on 12 Nov 2026 from the README and the commit history, so the reasons behind the older parts of the site are in one place too. The README has the full detail.*

### 12. Visitors never call the market APIs
**Decision:** every market's data is built by Node scripts in GitHub Actions and published as JSON next to the page; browsers read only those files.
- No API keys in the page, no rate limits per visitor, and every visitor sees the same numbers.
- The one exception is the crypto fallback: if `data.json` is missing or more than 45 minutes old, the page runs the same `scripts/build-data.mjs` in the browser, at most once per 10 minutes per browser, and caches the result.
- TradingView, the prediction venues and the bond sources are never contacted by a visitor's browser (TradingView only when its link is clicked).

### 13. A failing source never empties a page
**Decision:** each builder starts from the last published file (`PREV_URL`). A source that fails keeps its last data, marked late or "?"; a builder that fails or times out republishes the last good file. The hourly freshness check (`scripts/check-fresh.mjs`) then catches anything that stays stale, since the deploy itself still "succeeds".

### 14. One timer service, GitHub as backup
**Decision:** cron-job.org starts the data update (every 10 min), the scorer (daily 00:20 UTC) and the freshness check (hourly) through GitHub's API, with a fine-grained token limited to this repo (Actions read/write; it expires in September 2027 and must be renewed in all three jobs). GitHub's own schedules stay on as a backup: on their own they ran about 1 time in 15. The scorer's daily commit also stops GitHub pausing the schedules for inactivity.

### 15. One signal engine for the page, the scorer and the tuner
**Decision:** every indicator and 🚀/😢 rule lives in `signals.mjs`, imported by the page, `scripts/score.mjs` and the tuner, so what the page shows is exactly what gets scored. Changes there need the unit tests.

### 16. One page template for every market
**Decision:** `/forex/`, `/metals/`, `/energy/`, `/etfs/`, `/rates/` and `/predictions/` are made from `index.html` at deploy (`scripts/market-page.mjs`), with only the search tags, About/FAQ and source credits swapped in from `seo/`. Everything market-specific sits in one adapter per market (`app/markets.mjs`), so a fix to tiles, popups or filters reaches every page. Rates and predictions aren't price heatmaps, so they have their own drawing modules (`app/rates.mjs`, `app/predictions.mjs`) started by `main.mjs`.

### 17. Coins are matched to exchange pairs by ID, not ticker
**Decision:** each coin's USDT pair comes from CoinGecko's per-coin tickers (`data/pairs.json`, refreshed weekly), so two coins sharing a ticker, or a renamed coin (Toncoin now trades as GRAM), can't pull in the wrong price history. ✓ marks a confirmed pair, ? a ticker guess.

### 18. The scorecard is built not to fool us
**Decision:**
- **Fair figures first:** the Scorecard leads with the point-in-time days (each day judged on that day's top 100, including coins that later left it). The longer history on today's list comes second, labelled as too kind to the signals, because coins are in today's list partly because they rose.
- **Untouched holdout:** the tuner never sees the newest 90 days.
- **Hard to change settings:** new settings must win at least 2 of 3 walk-forward periods and do better on average, a signal needs t ≥ 2.5 to be switched on, and new signal settings must also hold on the fair days (none adopted until there are 60 of them).
- **Costs shown:** results also appear after an estimated round-trip cost (about 0.2% crypto, 0.05% forex).
- **Honest wording:** the emoji describe conditions, not predictions, and each one is small and grey until the Scorecard shows its signal works (`provenSignals`).

### 19. Real jumps stay in the forex record
**Decision:** jumps in official ECB rates (the lira crises, the franc in 2015) really happened, so they stay in the scoring; leaving them out would make the record look calmer than reality. Jumps in the community feed may be data glitches, so those days are left out. Pegged currencies, IRR and SYP are never scored.

### 20. A scorecard needs enough assets
**Decision:** the scorecard ranks assets against each other each day and needs at least ten, so metals (4) and energy (6) have none. ETFs have enough but no scorecard yet. These pages use the crypto signal settings.

### 21. Fresh or official, otherwise left out
**Decision:** a price that can't be shown fresh, or a source whose terms don't allow republishing, is left out rather than shown late or borrowed.
- Energy shows only benchmarks with a free quote about 10 minutes behind (Urals, Dubai, JKM and others come from paid agencies).
- Rates use official sources only, once a business day; live yields exist only on feeds that may not be republished.
- Gulf pump prices and Gulf yield curves have no data feed; Morocco's site refuses GitHub's servers; copper has no free public-domain feed.

### 22. Colour that everyone reads the same
**Decision:** blue is up and red is down on every price page (a soft grey for flat), so nothing reads as a party or as "good/bad". Where colour carries meaning on its own (rates readings, prediction chances) it also comes with a shape or type style and stays colour-blind safe: one blue hue stepping in lightness on predictions, arrows and pills on rates.

### 23. A deploy can't serve a page with old or missing scripts
**Decision:** the deploy appends `?v=<commit>` to every module import, so a browser never mixes an old cached script with a new page. Files are copied into the site from an explicit list, and `tests/deploy.test.mjs` checks every imported module is on it: a missing copy (`scripts/build-forex.mjs`, for the dollar index bar) once broke every page.

### 24. The popup never gets in the way
**Decision:** the coin popup fits a 13-inch screen (720px, two columns), opens only when the mouse rests on a tile for about 0.7 s (or at once from the ⓘ), opens on the side the mouse came from, stays open while the mouse heads into it, and pins on click. Phones get a bottom sheet. Both are covered by the browser tests.

### 25. Self-hosted, with one counter
**Decision:** the Inter font is served from the site (no calls to Google). The only third-party script is the shared GoatCounter counter (`salacompany.goatcounter.com`), the same snippet as the other sala.company sites; market pages inherit it from `index.html`.

### 26. A tiny file for other sites
**Decision:** go.sala.company's live strip reads `pulse.json` (a handful of headline prices, well under 1 KB, built at the end of each deploy by `scripts/pulse.mjs`) instead of downloading `data.json`. A missing file or coin is left out, never guessed.

## Working on the repo

*12 Nov 2026, from the conversation that started this round of improvements.*

### 27. Plain words in page text, code and docs
**Decision:** the scorecard and rates text now say today's list "makes the signals look better", is "too kind to the signals" or leaves "a bias in the signals' favour", and that a yield gap was "less steep". The old single word for these could be misread, and plain words say the same thing more clearly. New text should keep to plain wording like this (commit `eff47e3`).

### 28. Branch first, merge when both test suites pass
**Decision:** work happens on a branch (a Claude session uses its own `claude/...` branch). Unit and browser tests run on every push to any branch; the branch is merged into `main` only when both pass, because a push to `main` deploys live. Pull `main` first: the scorer commits to it every day.

### 29. Docs move with the code
**Decision:** a change that alters behaviour also updates the README, a decision here when there's a "why" worth keeping, and `docs/rebuild-prompts.md` when it adds a feature, so the project can still be rebuilt from the prompts in order.

## At a glance

*13 Nov 2026, from a critique of the site as a first-time visitor sees it (laptop and phone screenshots): the data was all there, but a visitor had to work out the story; on a phone the controls filled most of the first screen, and the warning covered the header.*

### 30. Every price page leads with a headline
**Decision:** a line above the tiles gives the typical move, how many rose and fell (with a bar of the split) and the biggest gain and drop. On crypto the move is weighted by market cap, like a market index; elsewhere it's the **median**, because an equal-weight average was dragged by a single outlier (one currency's devaluation moved "the average" more than the other 47 together). It describes what's shown, so a filter narrows it, and ETF group headings carry their own average.

### 31. The market switch carries each market's figure
**Decision:** each market's tab shows its headline move (Bitcoin, the dollar index, gold, Brent, SPY, the US 10-year in bp), so every page doubles as a cross-market glance. The figures come from a separate `xm` field in `pulse.json`, built at the end of the deploy from the files just made: no page downloads another page's data, and `items`, which go.sala.company reads, is unchanged. Predictions have no single figure, so their tab has none.

### 32. Map sizes by the square root
**Decision:** crypto and ETFs get a Map view where area follows market cap (crypto) or dollars traded a day (ETFs; there's no free AUM feed). Linear sizes would give Bitcoin about half the map and leave most coins as unreadable slivers, so area follows the **square root**, as on the predictions money map; the order by size is kept and the note under the map says so. Forex, metals and energy have nothing meaningful to size by, so they don't offer it. The treemap layout moved to `app/treemap.mjs`, shared with the money map.

### 33. Narrower "flat" band
**Decision:** the grey middle of the colour scale was wide enough (±1% a day for crypto, ±0.5% for ETFs) that on a calm day most tiles were grey and the colour said nothing. The first step is now about half as wide on crypto, metals, energy, ETFs and rates; the outer steps are unchanged, so big days look the same as before. Forex already used ±0.1% and stays.

### 34. A week's line on heatmap tiles
**Decision:** heatmap tiles show the last week's closes as a small line in the tile's own ink, so a −1% day inside a strong week reads differently from one in a slide, without opening the card. Detailed tiles already carry the trend rows, so they don't.

### 35. The warning sits above the page, not on it
**Decision:** the work-in-progress notice is a slim line at the top of the page instead of a floating card over the header (which hid the refresh time and the market switch on every first visit, and most of a phone screen). It still appears on a first visit and 30 days after it's dismissed; "More" and ⚠ WIP show the full text.

### 36. Phones: data before controls
**Decision:** on a phone the market switch and a ⚙ View button replace the rows of controls (timeframe, view, tile style, filters, Reset, the stablecoin box and How to read open below the button, which shows a badge when something differs from the default). The countdown, refresh, link and theme buttons fold away. Goal, checked by a browser test: the first tiles start in the top third of the screen (they started three quarters down).

### 37. Rates: the yield first, the rest on demand
**Decision:** a rate card leads with the 10-year yield, its move and the curve reading. The real yield, inflation, the risk rank and the gap to the benchmark moved to the popup and the table; a card keeps only what's unusual: **▲ High risk**, or a yield below inflation (from −0.05%, so rounding to "−0.0%" doesn't count). A column chart above the cards, highest yield first, shows every market's level at once.

### 38. Predictions: one news strip
**Decision:** Today, Since your last visit and Just decided were three stacked sections above the board; they're now one row of small cards (a sideways swipe when they don't fit), so the board starts in the top half of a laptop screen. On the palest tiles only the answer and its chance fade; the question stays at full strength.

### 39. UI changes are checked in the preview, at two sizes and in both themes
**Decision:** a Claude cloud session can't reach heat.sala.company or download the deploy's files (the network blocks both), so a UI change is checked in the local preview (`npm run dev`, deterministic test data) with screenshots on a laptop (1440×900) and a phone, in light and dark mode, and measured where it matters (where the first tile starts, no sideways scroll), before it's merged. Each new part gets a browser test. The limit: test data isn't live data, so a change that depends on the shape of real data (the market-switch figures read `forex.json` and `rates.json` through `pulse.json`) is confirmed on the live site after the deploy.

## The next click

*13 Nov 2026, from a second critique: the first screen was in good shape, but the next click (the coin card, the table, the scorecard) still left the reading to the visitor, and the price pages lacked basics the predictions page already had.*

### 40. The coin card says what it sees
**Decision:** the card's first line puts the readings into words (trend, a recent cross, RSI zone, a big 30-day move, the year range, a stop that's near or crossed, a volume surge), like the prediction card's answer-first line. It only restates what the card already shows below, so it adds no new judgement; the scorecard still says whether any of it predicts anything.

### 41. The year range, named by the history there is
**Decision:** where the price sits between its lowest and highest close over the last 365 days is shown as a bar in the card, a row on detailed tiles and a table column. Crypto's `data.json` keeps 260 daily closes, so its span is about 9 months; the label says "9-month range" rather than claiming a year, and "1-year" only where the history covers it.

### 42. Search and a watchlist on the price pages
**Decision:** a search box (and the `/` key) filters by symbol or name across the grid, map and table, and ☆ Watch pins items to a row at the top of the grid. Both already existed on the predictions page; 100 coins or 112 ETFs are too many to scan. The watchlist lives in this browser only (`hm.watch.<market>`), one list per market, and pinned items leave their usual place rather than appearing twice.

### 43. The scorecard view drops the price controls
**Decision:** the filters, colour scale, timeframe and search do nothing in the Scorecard view, so they're hidden there and the view opens on its answer.

### 44. A repeat visit draws the last copy first
**Decision:** each successful load keeps a copy of the market's file in this browser (`hm.last.<market>`, only under 3 MB of text, used only if under a day old), and the next visit draws it at once, says it's showing last visit's prices, and swaps in the fresh file when it arrives. The refresh line shows the copy's own time, so it never passes old prices off as new. Any storage error just means no instant draw. The next refresh is still timed from the build, not from the copy.

### 45. Chart labels: the stops win
**Decision:** when a stop sits near the price, its label overprinted the price-scale number (and the other stop's label). The stop labels are now pushed at least 11px apart and any scale number within 11px of one is left out: the stop is the more useful number there.

### 46. The open View panel never runs off a phone screen
**Decision:** everything in the phone's ⚙ View panel (search included) is held to the panel's width, and the browser test checks nothing runs past its edge.

## Prediction tiles: which answer is winning

*13 Nov 2026, from a live tile: "Putin out as President of Russia by June 30, 2027? · Almost certain · No, it won’t · 92%". Readers couldn't tell whether the market expected Putin out or not.*

### 47. Yes/no as a statement, a labelled chance and a two-sided bar
**Decision:** three problems stacked up: the verdict word ("Almost certain") described the No side but read as describing the event; "No, it won't" answered a positively worded question, so it had to be reversed in the head; and "92%" didn't say what it was a chance of. Now a yes/no answer reads as the market's expectation ("Market expects · ✗ No, it won't happen"), with a ✓ / ✗ mark so it doesn't rely on colour, the number says it's a chance ("92% chance"), and a bar names both sides ("Yes 8% · No 92%", the likelier one bold and filled). Under 60% the heading says "Too close to call · leaning" rather than claiming an expectation. Small tiles and one-line places (news strip, money map, table, page title) use the short form "✗ Won't happen 92%". Ladder steps written into the question ("by June 30, 2027?") are yes/no and read the same. Who-wins questions and number ladders keep their verdict words, since there the verdict describes a named answer. The static question pages follow ("The market expects: ✗ No, it won't happen 92% chance", with "Yes 8% · No 92%" under it).

