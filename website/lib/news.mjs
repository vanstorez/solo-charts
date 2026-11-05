import { fetchText, UA } from "./market.mjs";

const FEED_CACHE = new Map();
const CACHE_MS = 8 * 60_000;

const CATEGORIES = {
  india: {
    label: "India markets",
    query: '"Nifty" OR "Sensex" OR "BSE" OR "NSE" India stock market when:1d',
    locale: "IN"
  },
  global: {
    label: "Global markets",
    query: '"Wall Street" OR "S&P 500" OR Nasdaq OR "global stocks" when:1d',
    locale: "US"
  },
  commodities: {
    label: "Commodities",
    query: '"Brent crude" OR "WTI" OR gold OR copper commodity prices when:1d',
    locale: "US"
  },
  economy: {
    label: "Economy & policy",
    query: '"RBI" OR inflation OR GDP OR "Union Budget" India economy when:3d',
    locale: "IN"
  },
  corporate: {
    label: "Corporate & earnings",
    query: 'India earnings OR "Q2 results" OR IPO OR "block deal" when:2d',
    locale: "IN"
  },
  crypto: {
    label: "Crypto",
    query: 'Bitcoin OR Ethereum OR crypto market when:1d',
    locale: "US"
  },
  forex: {
    label: "Currencies",
    query: 'rupee dollar OR "dollar index" OR yen currency when:1d',
    locale: "IN"
  },
  geopolitics: {
    label: "Geopolitics & oil",
    query: 'oil geopolitics OR Iran OR Hormuz OR sanctions when:2d',
    locale: "US"
  },
  fed: {
    label: "Fed & FOMC",
    query: '"Federal Reserve" OR FOMC OR "rate cut" OR "25 basis points" when:3d',
    locale: "US"
  },
  policy: {
    label: "India policy & GIFT City",
    query: '"GIFT City" OR "foreign investors" tax India OR "RBI Governor" OR "Finance Minister" when:7d',
    locale: "IN"
  },
  rareearth: {
    label: "Rare earth metals",
    query: '"rare earth" OR "rare earth metals" OR "China export controls" when:7d',
    locale: "US"
  },
  worldbank: {
    label: "World Bank & IMF",
    query: '"World Bank" meeting OR IMF meeting OR "global economy" when:14d',
    locale: "US"
  }
};

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function sentiment(title) {
  const text = String(title || "").toLowerCase();
  const positive = ["surge", "rally", "gain", "jump", "record high", "upgrade", "profit", "beat", "strong", "rebound", "optimism", "rise"];
  const negative = ["fall", "slump", "crash", "loss", "downgrade", "miss", "weak", "fear", "selloff", "warning", "probe", "drop", "concern"];
  const up = positive.filter((word) => text.includes(word)).length;
  const down = negative.filter((word) => text.includes(word)).length;
  return up > down ? "positive" : down > up ? "negative" : "neutral";
}

function timeAgo(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function googleNewsQuery(query, label, localeCode = "IN", limit = 8, category = "custom") {
  const locale = localeCode === "US" ? ["en-US", "US", "US:en"] : ["en-IN", "IN", "IN:en"];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale[0]}&gl=${locale[1]}&ceid=${locale[2]}`;
  const xml = await fetchText(url, { headers: UA }, 12_000, 0);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((match) => {
    const block = match[1];
    const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const source = stripTags((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "");
    const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim();
    const publishedIso = Number.isFinite(Date.parse(pub)) ? new Date(pub).toISOString() : new Date().toISOString();
    return {
      title,
      link,
      source,
      category,
      categoryLabel: label,
      published: pub.replace(" GMT", "").slice(0, 22),
      publishedIso,
      ago: timeAgo(publishedIso),
      sentiment: sentiment(title)
    };
  }).filter((item) => item.title);
}

async function googleNews(category, limit = 8) {
  const config = CATEGORIES[category];
  return googleNewsQuery(config.query, config.label, config.locale, limit, category);
}

export async function getNewsSearch(query, label = "Custom search", locale = "IN", limit = 6) {
  const key = `search:${label}:${query}`;
  const hit = FEED_CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = { category: "custom", label, items: [] };
  try {
    value.items = await googleNewsQuery(query, label, locale, limit);
  } catch {
    value.items = [];
  }
  value.asOf = new Date().toISOString();
  FEED_CACHE.set(key, { at: Date.now(), value });
  return value;
}

export async function getNewsFeed(category = "all") {
  const key = String(category || "all").toLowerCase();
  const hit = FEED_CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const selected = key === "all" ? Object.keys(CATEGORIES) : CATEGORIES[key] ? [key] : Object.keys(CATEGORIES);
  const groups = await Promise.all(selected.map(async (name) => {
    try {
      return await googleNews(name, 7);
    } catch {
      return [];
    }
  }));
  const seen = new Set();
  const items = [];
  for (const item of groups.flat()) {
    const dedupe = item.title.toLowerCase().slice(0, 90);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    items.push(item);
  }
  items.sort((a, b) => Date.parse(b.publishedIso) - Date.parse(a.publishedIso));
  const visibleItems = key === "all" ? items.slice(0, 64) : items;
  const value = {
    category: key === "all" ? "all" : key,
    categories: Object.entries(CATEGORIES).map(([name, config]) => ({ key: name, label: config.label })),
    items: visibleItems,
    counts: Object.fromEntries(Object.keys(CATEGORIES).map((name) => [name, visibleItems.filter((item) => item.category === name).length])),
    asOf: new Date().toISOString()
  };
  FEED_CACHE.set(key, { at: Date.now(), value });
  return value;
}
