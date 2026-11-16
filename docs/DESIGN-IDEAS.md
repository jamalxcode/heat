# Design ideas

Ideas raised but **not built** (or built differently), so they aren't lost. Nothing here is a promise; when one is built, move it into the README and a decision. Rough effort: S small, M medium, L large.

## Raised and set aside

- **Always quote the chance of "Yes"** on prediction tiles ("8% chance · Very unlikely") instead of the likelier side. Option 2 of the yes/no suggestions; options 1, 3 and 5 were chosen instead (decision 47). Worth revisiting if readers still stumble. S
- **A full plain sentence per question** ("Market expects: Putin stays in office") written from the question itself. Needs reliable rewording of thousands of titles; the generic statement ("✗ No, it won't happen") was chosen. M–L
- **Tint the open market tab too.** Declined so the open tab keeps matching the panel it belongs to (decision 51). S
- **Linear sizes on the Map** (Bitcoin as half the map). The square root was chosen so the rest stay readable (decision 32).

## Noticed, not yet done

- **Topic icons that fit the question.** "Jensen Huang arrested by December 31, 2026?" shows a microscope (tech) icon; an arrest/legal question should get its own. S
- **Rates on phones:** fold the rates controls (Change/Curve/Real, timeframe, view, sort, group) behind a button like ⚙ View. S
- **Forex dollar-index card on phones** takes a lot of height above the tiles; a compact one-line version. S
- **Check the market-tab figures on live data** (`pulse.json` `xm`, built from `forex.json` and `rates.json`); only test data has been seen from a session. S
- **ETF scorecard:** 112 funds is enough to rank each day; it just hasn't been built. M
- **ETF Map by fund size (assets)** rather than dollars traded, if a free source appears. M
- **Stop alerts:** a browser notification when a watched coin closes past its stop. M
- **Compare with the benchmark** in the coin card (the coin's line over Bitcoin's / SPY's). M
- **Keyboard moves between tiles** (arrow keys), for people who browse without a mouse. S
- **A skeleton** (grey tiles) on a first visit while `data.json` loads; repeat visits already draw at once. S
- **Share images per question page** (an Open Graph image with the answer), so links preview with the market's answer. M
- **Time zones:** show times in the visitor's zone everywhere (some lines still use UTC dates). S
