# Solo on your phone — personal app setup

Your Solo terminal runs on your PC. Your phone can open it over your own home
Wi-Fi and install it as an app icon — fully personal use only.

## What you need

| Thing | Detail |
| --- | --- |
| PC running Solo | Double-click `scripts/start-solo.ps1` (or START script). Web: port 3000, API: port 8000 |
| Phone on the same Wi-Fi | Same network as the PC. If the Wi-Fi network is `ScottOP 18`, the phone must join `ScottOP 18` |
| Phone browser | Chrome (Android) or Safari (iPhone) |

> Nothing is sold, nothing is public. This is a private, local, personal terminal.
> Marketplace/price data comes from free public sources (Yahoo Finance, Binance)
> labelled delayed — fine for personal research, not for resale or paid signals.

## Android (Chrome)

1. Make sure the PC servers are running and the phone is on the same Wi-Fi.
2. In Chrome visit: `http://10.35.118.52:3000`
3. Chrome menu (⋮) → **Add to Home screen** → accept / **Install app** when shown.
4. Open "Solo" from your home screen — it launches fullscreen like an installed app,
   with the Solo icon, no browser bars.

## iPhone (Safari)

1. Same network + servers running.
2. In Safari visit: `http://10.35.118.52:3000`
3. Share button → **Add to Home Screen** → Add.
4. Open "Solo" from the home screen for an app-like, fullscreen experience.

## If the phone cannot connect

1. Check both servers are up on the PC (web `http://127.0.0.1:3000` must work on the PC itself).
2. Firewall: inbound TCP 3000 and 8000 must be allowed from LocalSubnet
   (rules for this already exist; re-check in Windows Defender Firewall → Inbound rules).
3. Some routers enable "AP / client isolation", which blocks phone ↔ PC traffic.
   If nothing helps, disable client isolation on the router.
4. IP change: if your PC's LAN IP changes, update the URL (host computer IP is shown
   on server start; current: `10.35.118.52`).

## What works on the phone already

- Charts, index scanner, crude & Wall Street page, watchlists, paper trading are all responsive
  (sidebar becomes a horizontally scrollable strip on small screens).
- Keyboard shortcuts are for desktop; on phone use the on-page buttons (Refresh, Rescan, Toggles, Full chart).
- Analysis page accepts links: open a full chart via `/analysis?symbol=NIFTY_IT&interval=1d`.

## Costs & limits

- Zero paid services. Free public data only, delayed snapshots, honestly labelled.
- The app depends on your PC running the two local servers. If the PC sleeps/shuts down,
  the phone app has nothing to load — start the servers again and refresh.
- Live broker execution stays hard-disabled everywhere. Paper trading only.
