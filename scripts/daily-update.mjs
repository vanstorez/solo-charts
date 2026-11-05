#!/usr/bin/env node
/**
 * Solo Trading Charts — daily market archive.
 *
 * This script is intentionally dependency-free. It pulls the same research
 * feeds used by the local terminal, writes a dated JSON snapshot and a
 * human-readable Markdown brief, and updates latest.json + index.json.
 *
 * Run locally:
 *   node scripts/daily-update.mjs
 *
 * GitHub Actions runs the same command on weekday mornings (IST).
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAiPlan } from "../website/lib/ai.mjs";
import { getQuotes } from "../website/lib/charts.mjs";
import { getMacroRadar } from "../website/lib/macro.mjs";
import { getLiveSnapshot } from "../website/lib/market.mjs";
import { getNewsFeed } from "../website/lib/news.mjs";
import { getScan } from "../website/lib/scanner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "website", "public", "data", "daily");
const QUOTE_KEYS = [
  "NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX", "GIFT", "BRENT", "WTI",
  "USDINR", "DXY", "US10Y", "SPX", "NDX", "GOLD", "BTCUSD"
];

function istDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function istStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function round(value, digits = 2) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits));
}

function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

async function attempt(label, fn, fallback, errors) {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${label}: ${error?.message || String(error)}`);
    console.error(`[daily] ${label} failed:`, error?.message || error);
    return fallback;
  }
}

function topScan(scan, limit = 20) {
  return [...(scan?.items || [])]
    .filter((item) => item.value != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function markdownBrief(snapshot, brief) {
  const date = brief.date;
  const quotes = snapshot?.quotes || [];
  const indexes = snapshot?.indexes || {};
  const plan = brief.aiPlan;
  const trade = plan?.trade;
  const option = plan?.option;
  const macro = brief.macro;
  const scan = topScan(brief.scan, 10);
  const indiaNews = (brief.news?.india || []).slice(0, 8);
  const globalNews = (brief.news?.global || []).slice(0, 6);
  const quoteLine = quotes
    .map((quote) => `${quote.label}: ${round(quote.value, quote.digits ?? 2)} (${pct(quote.change)})`)
    .join(" · ");
  const indexLines = ["SENSEX", "NIFTY", "BANKNIFTY"].map((key) => {
    const index = indexes[key];
    if (!index) return null;
    return `- **${key}**: spot ${round(index.spot)} · pivot ${round(index.pivot?.p)} · supports ${(index.levels?.supports || []).slice(0, 3).map((level) => round(level, 0)).join(", ")} · resistances ${(index.levels?.resistances || []).slice(0, 3).map((level) => round(level, 0)).join(", ")}`;
  }).filter(Boolean).join("\n");

  return `# Solo Trading Charts — daily desk brief

${istStamp(new Date(brief.generatedAt))}

**Research only. Not investment advice. No live orders are placed.**

## Market pulse

- **Bias**: ${snapshot?.bias || "—"} · **Score**: ${snapshot?.score ?? "—"} · **Market**: ${snapshot?.marketOpen ? "Open" : "Closed"}
- **India VIX**: ${round(snapshot?.regime?.vix?.value)} (${snapshot?.regime?.vix?.label || "—"}) · **Brent**: ${round(snapshot?.regime?.oil?.value)} (${snapshot?.regime?.oil?.label || "—"})
- ${quoteLine || "Quotes unavailable"}

## Index levels

${indexLines || "Index data unavailable."}

## Macro radar

${macro ? `- **Regime**: ${macro.regime}
- **Bank Nifty dependency**: correlation ${macro.bankNifty?.correlation ?? "—"} / beta ${macro.bankNifty?.beta ?? "—"} / ${macro.bankNifty?.dependency || "—"}
- **Rupee**: ${macro.rupee?.trend || "—"} — USD/INR ${round(macro.rupee?.quote?.value)} (1M ${pct(macro.rupee?.monthChange)}, 3M ${pct(macro.rupee?.quarterChange)})
- **Crude**: Brent ${round(macro.crude?.brent?.value)} (1M ${pct(macro.crude?.monthChange)}) — ${macro.crude?.risk || "—"} risk
- **War / stress gauge**: ${macro.war?.score ?? "—"}/100 (${macro.war?.label || "—"}) — drivers: ${(macro.war?.drivers || []).join("; ") || "none"}
- **Fed 25 bp playbook**: ${(macro.fed?.scenarios || []).map((scenario) => scenario.label).join(" / ") || "—"}` : "Macro radar unavailable."}

## AI plan — ${plan?.name || "NIFTY"}

${trade ? `- **${trade.side}** · ${plan.bias.label} · confidence ${plan.bias.confidence}%
- Entry trigger: **${round(trade.trigger ?? trade.entry)}**
- Hard stop: **${round(trade.stop)}** (${round(trade.stopPct)}%)
- Targets: **${(trade.targets || []).map((target) => round(target)).join(" / ")}**
- Risk budget: **${money(trade.riskAmount)}** · position ${trade.lots ?? "—"} lot(s) / ${trade.qty ?? "—"} units
- Max risk at stop: **${money(trade.maxLossAtStop)}**
${option ? `- Options overlay: **${option.strategy}** · ${option.expiry} · premium ${round(option.premium)} · stop ${round(option.stopPremium)} · target ${round(option.targetPremium)}` : ""}` : "No AI plan available."}

${plan?.warnings?.length ? `> ${plan.warnings.join("\n> ")}` : ""}

## Scanner leaders

${scan.length ? scan.map((item) => `- **${item.key}**: ${round(item.value)} (${pct(item.change)}) · RSI ${round(item.rsi, 1)} · ${item.trend || "—"} · score ${item.score ?? "—"}`).join("\n") : "No scanner data."}

## India headlines

${indiaNews.length ? indiaNews.map((item) => `- **${item.source || "News"}** — ${item.title} (${item.ago || ""})`).join("\n") : "No India headlines available."}

## Global headlines

${globalNews.length ? globalNews.map((item) => `- **${item.source || "News"}** — ${item.title} (${item.ago || ""})`).join("\n") : "No global headlines available."}

## Risk checklist

- Define the stop before the entry; never average a loser.
- Keep risk per trade at or below 1–2% of capital.
- Option buyers must respect premium stops and theta decay.
- Event risk, gaps and stale option-chain data can invalidate the plan.
- Verify every level and contract with your broker before risking capital.

> Generated automatically by Solo Trading Charts. Data may be delayed or stale.
`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const errors = [];
  const generatedAt = new Date().toISOString();
  const date = istDate(new Date(generatedAt));

  console.log(`[daily] building ${date} brief`);

  const [snapshot, scan, news, aiPlan, quotes, macro] = await Promise.all([
    attempt("live snapshot", () => getLiveSnapshot(), null, errors),
    attempt("scanner", () => getScan(), null, errors),
    attempt("news", () => getNewsFeed("all"), null, errors),
    attempt("ai plan", () => getAiPlan({ symbol: "NIFTY", style: "intraday", capital: 100000, riskPct: 1 }), null, errors),
    attempt("quotes", () => getQuotes(QUOTE_KEYS.join(",")), [], errors),
    attempt("macro radar", () => getMacroRadar(), null, errors)
  ]);

  const brief = {
    date,
    generatedAt,
    source: "Solo Trading Charts daily archive",
    disclaimer: "Research and paper trading only. Not investment advice.",
    snapshot,
    quotes,
    macro,
    scan: scan ? { ...scan, items: topScan(scan, 30) } : null,
    news: news ? {
      ...news,
      items: (news.items || []).slice(0, 40),
      india: (news.items || []).filter((item) => item.category === "india").slice(0, 12),
      global: (news.items || []).filter((item) => item.category === "global").slice(0, 10)
    } : null,
    aiPlan,
    errors
  };

  const json = JSON.stringify(brief, null, 2);
  const md = markdownBrief(snapshot, brief);
  await Promise.all([
    writeFile(path.join(OUT, `${date}.json`), json, "utf8"),
    writeFile(path.join(OUT, `${date}.md`), md, "utf8"),
    writeFile(path.join(OUT, "latest.json"), json, "utf8"),
    writeFile(path.join(OUT, "latest.md"), md, "utf8")
  ]);

  const files = (await readdir(OUT))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse();
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ dates: files.map((file) => file.replace(".json", "")), updatedAt: generatedAt }, null, 2), "utf8");

  console.log(`[daily] wrote ${path.relative(ROOT, path.join(OUT, `${date}.json`))} (${Buffer.byteLength(json)} bytes)`);
  if (errors.length) console.log(`[daily] completed with ${errors.length} warning(s)`);
}

main().catch((error) => {
  console.error("[daily] fatal:", error);
  process.exitCode = 1;
});
