const ADAPTERS = [
  {
    key: "paper",
    name: "Solo Paper Broker",
    mode: "paper",
    description: "Simulated fills using live option-chain marks. No real money, no exchange order.",
    env: [],
    configured: true
  },
  {
    key: "zerodha",
    name: "Zerodha Kite",
    mode: "live",
    description: "Kite Connect order bridge. Requires a Kite developer app and server-side credentials.",
    env: ["KITE_API_KEY", "KITE_API_SECRET"],
    configured: false
  },
  {
    key: "upstox",
    name: "Upstox",
    mode: "live",
    description: "Upstox API v2 order bridge. Requires an approved app and access token.",
    env: ["UPSTOX_API_KEY", "UPSTOX_API_SECRET"],
    configured: false
  },
  {
    key: "angelone",
    name: "Angel One",
    mode: "live",
    description: "SmartAPI order bridge. Requires an API key, client code and PIN/TOTP setup.",
    env: ["ANGEL_API_KEY", "ANGEL_CLIENT_ID"],
    configured: false
  },
  {
    key: "dhan",
    name: "Dhan",
    mode: "live",
    description: "DhanHQ order bridge. Requires an access token with trading permissions.",
    env: ["DHAN_ACCESS_TOKEN"],
    configured: false
  }
];

export function getBrokerStatus() {
  const adapters = ADAPTERS.map((adapter) => ({
    key: adapter.key,
    name: adapter.name,
    mode: adapter.mode,
    description: adapter.description,
    env: adapter.env,
    configured: adapter.configured || adapter.env.every((name) => !!process.env[name]),
    liveOrdersEnabled: false
  }));
  return {
    adapters,
    defaultAdapter: "paper",
    liveOrdersEnabled: false,
    note: "Live broker adapters are scaffolds. This build never sends real orders. Configure credentials server-side and implement the adapter order method before enabling live trading.",
    asOf: new Date().toISOString()
  };
}
