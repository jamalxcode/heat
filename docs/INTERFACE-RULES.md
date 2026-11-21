# Interface rules

How the site **looks, reads and behaves**. Data rules are in [`BUSINESS-RULES.md`](BUSINESS-RULES.md); the reasons in [`DECISIONS.md`](DECISIONS.md) (numbers in brackets). Most of these are checked by the browser tests in `tests/e2e/site.spec.mjs`.

## The first screen

- **Data before controls.** On a phone the first tiles start in the **top third** of the screen; on a 13-inch laptop in the **top 40%** (the market tabs take a row) [36, 50].
- **Every price page has a headline** above the tiles: typical move (weighted by market cap on crypto, the median elsewhere), ▲ up / ▼ down with a split bar, best and worst (each opens its card) [30].
- **The warning is one slim line** above the page on a first visit, never a card over it [35].
- **The market tabs** are folder tabs on their own row: 15px, the open page's tab raised in the panel's colour with a flame strip, joined to the panel below; the others filled with a lighter shade of their figure's colour, outlined 2px, lifting on hover. Predictions (no figure) stays neutral [50, 51].
- **Phones:** tabs scroll sideways; ⚙ View (beside the colour key) opens the rest of the controls in a panel joined to the open tab; nothing in that panel may run past the screen edge [36, 46].
- **No sideways scrolling of the page**, on any page, at phone width.

## Colour

- **Blue is up, red is down, soft grey is flat** on every price page; stronger shades for bigger moves; in dark mode, deep for small moves and bright for big ones [22].
- **Never colour alone.** Every coloured meaning also has a sign, a word, a shape or a mark: ▲/▼, ✓/✗, ↗/→/↘ for curve readings, pills with arrows for real yield and risk [22].
- **Predictions** use one blue hue stepping in lightness for "how likely" (colour-blind safe), with bold for likely and italic serif for unlikely on the big answer only; teal ▲ / amber ▼ for moves, so nothing reads as a party.
- The colour scale's grey band is narrow enough that a calm day still shows a tint (crypto ±0.5%, ETFs ±0.2%; forex ±0.1%) [33].
- WCAG AA contrast in light and dark; text on a tinted fill uses that fill's ink colour.

## Words

- **Plain words** in page text, code and docs; no word that could be misread (decision 27).
- **Say what it means.** The coin card's first line puts its readings into words ("▲ Strong uptrend · overbought (RSI 88) · near its short stop") [40]. A yes/no answer is a statement with ✓/✗ ("Market expects · ✗ No, it won't happen"), its number labelled "chance", and a bar naming both sides; small tiles use the short form "✗ Won't happen" [47].
- **Results read as results:** a decided yes/no says "✓ Yes" / "✗ No" [48].
- **Name spans honestly:** "9-month range" when the history is 9 months [41]; "not real-time" next to every refresh time; last visit's prices are marked as such [44].
- Units always shown (bp, pp, %, $/litre); numbers with a sign.

## Tiles, cards and charts

- **Heatmap tiles** (default): colour, symbol, change, price and a week's line; ⚠ caution and 🛑 stop stay visible [34]. **Detailed tiles:** every reading as a row, including the year range; the price is 2px bigger than the change and bold (18px vs 16px; 16.5px vs 14.5px on phones) [56].
- **Map view** (crypto, ETFs): area by the square root of the size, a note under the map says so [32].
- **The coin card:** words first, then the numbers; two columns that fit a **13-inch** screen (720px); a bottom sheet on phones; ☆ Watch in its header [24, 42].
- **Chart labels never overprint:** stop labels 11px apart; a price-scale number near one is dropped [45].
- **Rates cards** lead with the 10-year yield and its move; only the unusual (High risk, yield below inflation) on the card; a column chart of every yield above them [37].
- **Prediction tiles:** answer and chance stacked under the question; 2×2 tiles only with something to fill them; money bet today in the header chip [9–11]. The news (Today, since your visit, just decided) is **one row** of small cards [38].

## Interaction

- **Hover:** a card opens after the mouse **rests about 0.7 s** (or at once from ⓘ), on the side the mouse came from; heading into it keeps it open; a click pins it; Escape, ×, the backdrop or a click outside closes it [24].
- **Search:** "/" jumps to it; it filters grid, map and table as you type; Escape clears it [42].
- **Links carry the view** (`?f=…&tf=…&view=…&coin=…`), but a link never overwrites the visitor's saved settings.
- **Remembered per browser:** theme, tile style, chart type, "How to read", the watchlist (per market), the warning's dismissal (30 days).
- **The scorecard view hides the price controls** [43].
- **↗ Share** in every card header opens a row of options under the header (share sheet, WhatsApp, Telegram, X, email, copy, picture); the button closes it again, and nothing in it closes the card [54]. A shared or copied message leads with the question or name and says what its link opens ("👉 Live odds from every venue…: link") [55].

## Build and assets

- Vanilla ES modules, no bundler; every module the page imports must be in the deploy's copy list (`tests/deploy.test.mjs`) [23].
- Self-hosted Inter; the only third-party script is the shared GoatCounter counter [25].
- `prefers-reduced-motion` turns animations off; inputs are 16px on phones so iPhones don't zoom.
- Browser tests make no outside calls (fixtures only).

## How a visual change is made

1. Start from a screenshot of the live site (or a critique of it).
2. Offer a few concrete options with how each would read; let the user pick or combine; confirm before coding when asked [52].
3. Build it on the session's branch; check it in `npm run dev` on a laptop (1440×900, 1280×720) and a phone, **light and dark**, and on **every tile size** [39, 49].
4. Add a browser test for it; run unit and browser tests; merge to `main` only when both pass [28].
5. Update the README, a decision when the why is worth keeping, and a rebuild prompt [29].
