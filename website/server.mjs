import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAiPlan } from "./lib/ai.mjs";
import { runBacktest, STRATEGIES } from "./lib/backtest.mjs";
import { getBrokerStatus } from "./lib/broker.mjs";
import { getChart, getQuotes, getWatchlist } from "./lib/charts.mjs";
import { getMarketContext, getNews, INDEXES } from "./lib/market.mjs";
import { getMacroRadar } from "./lib/macro.mjs";
import { getNewsFeed } from "./lib/news.mjs";
import { getOptionChain, optionIndexes, runOptionBacktest, simulatePayoff } from "./lib/options.mjs";
import { getScan } from "./lib/scanner.mjs";
import { searchSymbols, symbolList } from "./lib/symbols.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function errorPayload(err) {
  return {
    error: true,
    message: err?.message || String(err)
  };
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  try {
    if (pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "Solo Trading Charts",
        now: new Date().toISOString(),
        port: PORT
      });
      return;
    }

    if (pathname === "/api/config") {
      sendJson(res, 200, {
        indexes: Object.values(INDEXES).map(({ key, name, lotSize, strikeStep }) => ({ key, name, lotSize, strikeStep })),
        optionIndexes: optionIndexes(),
        strategies: STRATEGIES
      });
      return;
    }

    if (pathname === "/api/live" && req.method === "GET") {
      const data = await getMarketContext();
      sendJson(res, 200, data);
      return;
    }

    if (pathname === "/api/news" && req.method === "GET") {
      sendJson(res, 200, { items: await getNews() });
      return;
    }

    if (pathname === "/api/chart" && req.method === "GET") {
      const symbol = url.searchParams.get("symbol") || "NIFTY";
      const interval = url.searchParams.get("interval") || "1d";
      const range = url.searchParams.get("range") || "1y";
      sendJson(res, 200, await getChart(symbol, interval, range));
      return;
    }

    if (pathname === "/api/watchlist" && req.method === "GET") {
      sendJson(res, 200, { items: await getWatchlist(), asOf: new Date().toISOString() });
      return;
    }

    if (pathname === "/api/quotes" && req.method === "GET") {
      sendJson(res, 200, { items: await getQuotes(url.searchParams.get("symbols") || ""), asOf: new Date().toISOString() });
      return;
    }

    if (pathname === "/api/scan" && req.method === "GET") {
      sendJson(res, 200, await getScan());
      return;
    }

    if (pathname === "/api/news/feed" && req.method === "GET") {
      sendJson(res, 200, await getNewsFeed(url.searchParams.get("category") || "all"));
      return;
    }

    if (pathname === "/api/macro/radar" && req.method === "GET") {
      sendJson(res, 200, await getMacroRadar());
      return;
    }

    if (pathname === "/api/ai/plan" && req.method === "GET") {
      sendJson(res, 200, await getAiPlan({
        symbol: url.searchParams.get("symbol") || "NIFTY",
        style: url.searchParams.get("style") || "intraday",
        capital: url.searchParams.get("capital") || 100000,
        riskPct: url.searchParams.get("risk") || 1,
        direction: url.searchParams.get("direction") || "auto"
      }));
      return;
    }

    if (pathname === "/api/broker/status" && req.method === "GET") {
      sendJson(res, 200, getBrokerStatus());
      return;
    }

    if (pathname === "/api/daily/latest" && req.method === "GET") {
      try {
        const raw = await readFile(path.join(PUBLIC, "data", "daily", "latest.json"), "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 404, { error: true, message: "No daily archive yet. Run node scripts/daily-update.mjs." });
      }
      return;
    }

    if (pathname === "/api/daily/index" && req.method === "GET") {
      try {
        const raw = await readFile(path.join(PUBLIC, "data", "daily", "index.json"), "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 200, { dates: [], updatedAt: null });
      }
      return;
    }

    if (pathname === "/api/search" && req.method === "GET") {
      sendJson(res, 200, { items: await searchSymbols(url.searchParams.get("q") || "") });
      return;
    }

    if (pathname === "/api/symbols" && req.method === "GET") {
      sendJson(res, 200, { items: symbolList() });
      return;
    }

    if (pathname === "/api/backtest" && req.method === "POST") {
      const body = await readBody(req);
      const result = await runBacktest(body);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/options/chain" && req.method === "GET") {
      const symbol = (url.searchParams.get("symbol") || "NIFTY").toUpperCase();
      const expiry = url.searchParams.get("expiry") || null;
      const chain = await getOptionChain(symbol, expiry);
      sendJson(res, 200, chain);
      return;
    }

    if (pathname === "/api/options/payoff" && req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, simulatePayoff(body));
      return;
    }

    if (pathname === "/api/options/backtest" && req.method === "POST") {
      const body = await readBody(req);
      const result = await runOptionBacktest(body);
      sendJson(res, 200, result);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: true, message: "Unknown API route" });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${pathname} ->`, err?.message || err);
    if (pathname.startsWith("/api/")) sendJson(res, 500, errorPayload(err));
    else sendText(res, 500, "Internal server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Solo Trading Charts running at http://localhost:${PORT}`);
  console.log("Data: TradingView scanner + Yahoo Finance + NSE option chain");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT to another value, e.g. $env:PORT=8788`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
