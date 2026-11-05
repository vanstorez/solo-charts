/* Symbol universe for the Solo Trading Charts workspace. */

const index = (key, name, tv, yahoo, exchange, extra = {}) => ({
  key,
  name,
  short: name,
  tv,
  yahoo,
  exchange,
  type: "index",
  currency: "INR",
  ...extra
});

const stock = (key, name, tv, yahoo, sector) => ({
  key,
  name,
  short: key,
  tv,
  yahoo,
  exchange: "NSE",
  type: "stock",
  currency: "INR",
  sector
});

const global = (key, name, tv, yahoo, exchange, currency = "USD") => ({
  key,
  name,
  short: key,
  tv,
  yahoo,
  exchange,
  type: "global",
  currency
});

export const SYMBOLS = [
  index("NIFTY", "Nifty 50", "NSE:NIFTY", "^NSEI", "NSE", { lotSize: 75, strikeStep: 50 }),
  index("BANKNIFTY", "Bank Nifty", "NSE:BANKNIFTY", "^NSEBANK", "NSE", { lotSize: 35, strikeStep: 100 }),
  index("SENSEX", "Sensex", "BSE:SENSEX", "^BSESN", "BSE", { lotSize: 20, strikeStep: 100 }),
  index("INDIAVIX", "India VIX", "NSE:INDIAVIX", "^INDIAVIX", "NSE"),

  global("SPX", "S&P 500", "TVC:SPX", "^GSPC", "SP"),
  global("NDX", "Nasdaq 100", "TVC:NDX", "^NDX", "NASDAQ"),
  global("DJI", "Dow Jones", "TVC:DJI", "^DJI", "DJ"),
  global("BRENT", "Brent crude", "NYMEX:BZ1!", "BZ=F", "NYMEX"),
  global("WTI", "WTI crude", "NYMEX:CL1!", "CL=F", "NYMEX"),
  global("GOLD", "Gold futures", "COMEX:GC1!", "GC=F", "COMEX"),
  global("USDINR", "USD / INR", "FX_IDC:USDINR", "INR=X", "FX", "INR"),
  global("DXY", "Dollar index", "TVC:DXY", "DX-Y.NYB", "ICE"),
  global("US10Y", "US 10-year yield", "TVC:US10Y", "^TNX", "CBOT", "%"),
  global("BTCUSD", "Bitcoin", "BITSTAMP:BTCUSD", "BTC-USD", "Crypto", "USD"),
  global("ETHUSD", "Ethereum", "BITSTAMP:ETHUSD", "ETH-USD", "Crypto", "USD"),

  stock("RELIANCE", "Reliance Industries", "NSE:RELIANCE", "RELIANCE.NS", "Energy"),
  stock("TCS", "Tata Consultancy Services", "NSE:TCS", "TCS.NS", "IT"),
  stock("HDFCBANK", "HDFC Bank", "NSE:HDFCBANK", "HDFCBANK.NS", "Financials"),
  stock("ICICIBANK", "ICICI Bank", "NSE:ICICIBANK", "ICICIBANK.NS", "Financials"),
  stock("INFY", "Infosys", "NSE:INFY", "INFY.NS", "IT"),
  stock("SBIN", "State Bank of India", "NSE:SBIN", "SBIN.NS", "Financials"),
  stock("BHARTIARTL", "Bharti Airtel", "NSE:BHARTIARTL", "BHARTIARTL.NS", "Telecom"),
  stock("ITC", "ITC", "NSE:ITC", "ITC.NS", "FMCG"),
  stock("LT", "Larsen & Toubro", "NSE:LT", "LT.NS", "Industrials"),
  stock("AXISBANK", "Axis Bank", "NSE:AXISBANK", "AXISBANK.NS", "Financials"),
  stock("KOTAKBANK", "Kotak Mahindra Bank", "NSE:KOTAKBANK", "KOTAKBANK.NS", "Financials"),
  stock("HINDUNILVR", "Hindustan Unilever", "NSE:HINDUNILVR", "HINDUNILVR.NS", "FMCG"),
  stock("BAJFINANCE", "Bajaj Finance", "NSE:BAJFINANCE", "BAJFINANCE.NS", "Financials"),
  stock("MARUTI", "Maruti Suzuki", "NSE:MARUTI", "MARUTI.NS", "Auto"),
  stock("SUNPHARMA", "Sun Pharma", "NSE:SUNPHARMA", "SUNPHARMA.NS", "Pharma"),
  stock("TATASTEEL", "Tata Steel", "NSE:TATASTEEL", "TATASTEEL.NS", "Metals"),
  stock("ADANIENT", "Adani Enterprises", "NSE:ADANIENT", "ADANIENT.NS", "Conglomerate"),
  stock("TITAN", "Titan Company", "NSE:TITAN", "TITAN.NS", "Consumer"),
  stock("WIPRO", "Wipro", "NSE:WIPRO", "WIPRO.NS", "IT"),
  stock("HCLTECH", "HCL Technologies", "NSE:HCLTECH", "HCLTECH.NS", "IT"),
  stock("ASIANPAINT", "Asian Paints", "NSE:ASIANPAINT", "ASIANPAINT.NS", "Consumer"),
  stock("NTPC", "NTPC", "NSE:NTPC", "NTPC.NS", "Utilities"),
  stock("POWERGRID", "Power Grid", "NSE:POWERGRID", "POWERGRID.NS", "Utilities"),
  stock("ONGC", "ONGC", "NSE:ONGC", "ONGC.NS", "Energy"),
  stock("COALINDIA", "Coal India", "NSE:COALINDIA", "COALINDIA.NS", "Mining"),
  stock("M&M", "Mahindra & Mahindra", "NSE:M&M", "M&M.NS", "Auto"),
  stock("BAJAJFINSV", "Bajaj Finserv", "NSE:BAJAJFINSV", "BAJAJFINSV.NS", "Financials"),
  stock("ULTRACEMCO", "UltraTech Cement", "NSE:ULTRACEMCO", "ULTRACEMCO.NS", "Cement"),
  stock("NESTLEIND", "Nestle India", "NSE:NESTLEIND", "NESTLEIND.NS", "FMCG"),
  stock("TECHM", "Tech Mahindra", "NSE:TECHM", "TECHM.NS", "IT")
];

const byKey = new Map(SYMBOLS.map((s) => [s.key.toUpperCase(), s]));
const byYahoo = new Map(SYMBOLS.map((s) => [s.yahoo.toUpperCase(), s]));

export function resolveSymbol(input) {
  const raw = String(input || "").trim();
  if (!raw) return byKey.get("NIFTY");
  const upper = raw.toUpperCase();
  if (byKey.has(upper)) return byKey.get(upper);
  if (byYahoo.has(upper)) return byYahoo.get(upper);
  if (upper.startsWith("Y:")) {
    const yahoo = raw.slice(2);
    return {
      key: `Y:${yahoo}`,
      name: yahoo,
      short: yahoo.replace(/\.(NS|BO)$/i, ""),
      tv: null,
      yahoo,
      exchange: yahoo.endsWith(".NS") ? "NSE" : yahoo.endsWith(".BO") ? "BSE" : "Global",
      type: "global",
      currency: "USD"
    };
  }
  if (/[.=^]/.test(raw)) {
    return {
      key: `Y:${raw}`,
      name: raw,
      short: raw,
      tv: null,
      yahoo: raw,
      exchange: "Global",
      type: "global",
      currency: "USD"
    };
  }
  return null;
}

export function symbolList() {
  return SYMBOLS.slice();
}

export function defaultWatchlist() {
  return SYMBOLS.filter((s) => s.type === "index" || s.type === "stock").slice(0, 21);
}

export function tvMarket(tv) {
  if (!tv) return "global";
  return /^(NSE|BSE):/i.test(tv) ? "india" : "global";
}

export function tvChartLink(symbol) {
  if (symbol?.tv) return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol.tv)}`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol?.yahoo || "NSE:NIFTY")}`;
}

export async function searchSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return SYMBOLS.slice(0, 10).map((s) => publicSymbol(s));
  const upper = q.toUpperCase();
  const local = SYMBOLS
    .filter((s) => s.key.toUpperCase().includes(upper) || s.name.toUpperCase().includes(upper) || s.yahoo.toUpperCase().includes(upper))
    .slice(0, 8)
    .map((s) => publicSymbol(s));

  let remote = [];
  if (q.length >= 2) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const json = await res.json();
        remote = (json.quotes || [])
          .filter((x) => ["EQUITY", "INDEX", "ETF", "FUTURE", "CURRENCY", "CRYPTOCURRENCY"].includes(x.quoteType))
          .map((x) => {
            const known = byYahoo.get(String(x.symbol).toUpperCase());
            if (known) return publicSymbol(known);
            return {
              key: `Y:${x.symbol}`,
              name: x.shortname || x.longname || x.symbol,
              short: x.symbol,
              exchange: x.exchDisp || x.exchange || "Global",
              tv: null,
              yahoo: x.symbol,
              type: String(x.quoteType || "global").toLowerCase(),
              currency: "USD",
              source: "yahoo"
            };
          });
      }
    } catch {
      remote = [];
    }
  }
  const seen = new Set();
  return [...local, ...remote].filter((s) => {
    const key = String(s.key).toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export function publicSymbol(s) {
  return {
    key: s.key,
    name: s.name,
    short: s.short,
    exchange: s.exchange,
    tv: s.tv,
    yahoo: s.yahoo,
    type: s.type,
    currency: s.currency,
    sector: s.sector || null
  };
}
