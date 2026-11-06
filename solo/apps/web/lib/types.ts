export type Freshness = "fresh" | "aging" | "stale" | "unknown" | "unavailable";

export interface FeedMeta {
  provider: string;
  dataset: string;
  as_of: string | null;
  fetched_at: string;
  age_seconds: number | null;
  freshness: Freshness;
  source_type: string;
  status: string;
  delay_seconds: number | null;
  detail: string | null;
}

export interface Quote {
  key: string;
  name: string;
  short: string;
  exchange: string;
  type: string;
  currency: string;
  value: number | null;
  change: number | null;
  volume: number | null;  rsi: number | null;
  rating: number | null;
  as_of: string | null;
  source: string;
  data_status?: "live" | "delayed" | "unavailable" | string;
  delay_seconds?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previous_close?: number | null;
  bid?: number | null;
  ask?: number | null;
  open_interest?: number | null;
}

export interface GlobalQuote extends Quote {
  asset_class: string;
  region: string;
  country: string;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  day_high?: number | null;
  day_low?: number | null;
  error?: string | null;
}

export interface GlobalGroup {
  key: string;
  label: string;
  quotes: GlobalQuote[];
}

export interface GlobalMarketsResponse {
  indices: GlobalGroup[];
  fx: GlobalQuote[];
  commodities: GlobalQuote[];
  rates: GlobalQuote[];
  meta: FeedMeta;
  coverage: {
    requested: number;
    returned: number;
    failed: number;
    sources: string[];
    asset_classes: Record<string, number>;
    errors: Record<string, string>;
    note: string;
  };
  as_of: string | null;
  note: string;
}

export interface CryptoQuote {
  key: string;
  symbol: string;
  name: string;
  short: string;
  price: number | null;
  change: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume_base: number | null;
  volume_quote: number | null;
  as_of: string | null;
  source: string;
  data_status: string;
}

export interface CryptoStream {
  provider: string;
  transport: string;
  url: string;
  host: string;
  symbols: string[];
  update_mode: string;
  note: string;
}

export interface CryptoResponse {
  quotes: CryptoQuote[];
  meta: FeedMeta;
  stream: CryptoStream;
  coverage: {
    requested: number;
    returned: number;
    failed: number;
    errors: Record<string, string>;
    asset_class: string;
    quote_asset: string;
    note: string;
  };
  as_of: string | null;
  note: string;
}

export interface MarketSession {
  state: string;
  is_open: boolean;
  reason: string;
  ist_time: string;
  timezone: string;
  holiday_calendar: string;
  note: string;
}

export interface Overview {
  market_session: MarketSession;
  indices: Quote[];
  macro: Quote[];
  quote_meta: FeedMeta;
  as_of: string;
}

export interface ChartBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ChartSummary {
  rating: string;
  score: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atr_pct: number | null;
  change: number | null;
  high52: number | null;
  low52: number | null;
  max_drawdown_2y: { amount: number; pct: number } | null;
  signals: string[];
}

export interface ChartResponse {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  currency: string;
  interval: string;
  range: string;
  allowed_ranges: string[];
  bars: ChartBar[];
  quote: Quote | null;
  summary: ChartSummary;
  levels: { pivot: number | null; supports: number[]; resistances: number[] };
  daily_close: number;
  meta: FeedMeta;
  quote_meta: FeedMeta;
  as_of: string;
}

export interface StructureEvent {
  index: number;
  t: number;
  price: number;
  level: number;
  direction: "bullish" | "bearish";
  type: "BOS" | "CHoCH";
  label: string;
  swing_t: number;
}

export interface ChartZone {
  t: number;
  side: "bullish" | "bearish";
  top: number;
  bottom: number;
  status: "fresh" | "tested" | "invalidated" | "filled";
  label: string;
  event_t?: number;
  size?: number;
  filled_pct?: number;
  level?: number;
  extreme?: number;
}

export interface LiquiditySweep {
  t: number;
  side: "buy_side" | "sell_side";
  level: number;
  extreme: number;
  label: string;
}

export interface ParabolicPoint {
  t: number;
  value: number;
  trend: "bullish" | "bearish";
}

export interface PremiumDiscount {
  available: boolean;
  reason?: string;
  range_high?: number;
  range_low?: number;
  equilibrium?: number;
  position_pct?: number;
  zone?: "premium" | "discount" | "equilibrium";
  lookback?: number;
  note?: string;
}

export interface TimeframeTrend {
  label: string;
  interval: string;
  trend: "bullish" | "bearish" | "neutral" | "unavailable" | string;
  score: number | null;
  score_pct?: number;
  price: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  macd_hist: number | null;
  structure: string;
  last_event: string | null;
  bars: number;
  source: string;
  weight: number;
  error: string | null;
}

export interface AnalysisResponse {
  available: boolean;
  reason?: string;
  symbol?: string;
  name?: string;
  exchange?: string;
  interval?: string;
  range?: string;
  generated_at?: string;
  meta?: FeedMeta;
  input_provider?: string;
  structure?: {
    structure: {
      trend: string;
      events: StructureEvent[];
      last_event: StructureEvent | null;
    };
    parabolic_sar: {
      available: boolean;
      latest: ParabolicPoint | null;
      points: ParabolicPoint[];
    };
    swings: { index: number; t: number; price: number; kind: "high" | "low"; confirmed_at: number }[];
    order_blocks: ChartZone[];
    breaker_blocks: ChartZone[];
    fair_value_gaps: ChartZone[];
    liquidity_sweeps: LiquiditySweep[];
    premium_discount: PremiumDiscount;
    summary: string[];
    source: string;
  };
  mtf?: {
    timeframes: TimeframeTrend[];
    direction: string;
    alignment_pct: number | null;
    confidence_label: string;
    score: number | null;
    note: string;
  };
  indicator_contract?: { key: string; label: string; status: string; note: string }[];
  third_party_note?: string;
}

export interface AdvancedTimeframe {
  interval: string;
  bias: "bullish" | "bearish" | "neutral" | "unavailable";
  score: number;
  price: number | null;
  provider: string;
  bars: number;
}

export interface SupportResistanceLevel {
  price: number;
  touches: number;
  kind: "support" | "resistance";
  bars: number[];
}

export interface ChartPattern {
  type: string;
  label: string;
  price: number;
  t: number;
  bias: "bullish" | "bearish";
  note: string;
}

export interface AdvancedSignal {
  bias: "bullish" | "bearish" | "neutral" | "unavailable";
  score: number;
  reasons: string[];
}

export interface AdvancedIndicatorValues {
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  stoch_k: number | null;
  stoch_d: number | null;
  obv: number | null;
  vwap: number | null;
  adx: number | null;
  plus_di: number | null;
  minus_di: number | null;
  atr14: number | null;
  pivot: Record<string, number> | null;
  drawdown: { amount: number; pct: number; peak: number | null; trough: number | null };
  wma20: number | null;
  cci14: number | null;
  williams_r: number | null;
  roc12: number | null;
  supertrend: number | null;
  supertrend_dir: number | null;
  kc_upper: number | null;
  kc_middle: number | null;
  kc_lower: number | null;
  donchian_upper: number | null;
  donchian_middle: number | null;
  donchian_lower: number | null;
}

export interface AdvancedSeries {
  closes: (number | null)[];
  opens: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
  volumes: number[];
  times: number[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  bb_upper: (number | null)[];
  bb_lower: (number | null)[];
  rsi14: (number | null)[];
  macd_hist: (number | null)[];
  stoch_k: (number | null)[];
  stoch_d: (number | null)[];
  vwap: (number | null)[];
  wma20: (number | null)[];
  cci14: (number | null)[];
  williams_r: (number | null)[];
  roc12: (number | null)[];
  supertrend: (number | null)[];
  kc_upper: (number | null)[];
  kc_middle: (number | null)[];
  kc_lower: (number | null)[];
  donchian_upper: (number | null)[];
  donchian_middle: (number | null)[];
  donchian_lower: (number | null)[];
  candlestick_signals: ChartSignal[];
}

export interface ChartSignal {
  time: number;
  position: number;
  color: string;
  shape: "arrow_up" | "arrow_down";
  text: string;
  size: number;
  external: {
    pattern: string;
    side: "bullish" | "bearish" | "neutral";
    strength: string;
  };
}

export interface AdvancedAnalysisResponse {
  available: boolean;
  reason?: string;
  symbol?: string;
  name?: string;
  exchange?: string;
  interval?: string;
  range?: string;
  generated_at?: string;
  meta?: FeedMeta;
  input_provider?: string;
  price: number | null;
  change_pct: number | null;
  indicators: AdvancedIndicatorValues;
  levels: {
    support: SupportResistanceLevel[];
    resistance: SupportResistanceLevel[];
  };
  patterns: ChartPattern[];
  signal: AdvancedSignal;
  timeframes: AdvancedTimeframe[];
  series: AdvancedSeries;
  note: string;
}

export interface IndiaConclusion {
  bias: "bullish" | "bearish" | "mixed / neutral" | "unavailable";
  confidence_pct: number | null;
  bullish_count: number | null;
  bearish_count: number | null;
  neutral_count: number | null;
  note: string;
}

export interface IndiaMarketsResponse {
  market: string;
  quotes: GlobalQuote[];
  conclusion: IndiaConclusion;
  meta: FeedMeta;
  coverage: {
    requested: number;
    returned: number;
    failed: number;
    errors: Record<string, string>;
  };
  as_of: string | null;
  note: string;
}

export interface IndiaStatusResponse {
  market: string;
  provider: string;
  transport: string;
  freshness: string;
  instruments: number;
  indices: number;
  sectors: number;
  as_of: string;
  note: string;
}

export interface SymbolInfo {
  key: string;
  name: string;
  short: string;
  exchange: string;
  type: string;
  currency: string;
}

export interface SymbolsResponse {
  symbols: SymbolInfo[];
  intervals: string[];
  allowed_ranges: Record<string, string[]>;
}

export interface NewsArticle {
  id: string;
  title: string;
  source: string;
  link: string;
  published_at: string | null;
  feed_category: string;
}

export interface NewsEvent {
  id: string;
  headline: string;
  event_type: string;
  event_label: string;
  tone: string;
  published_at: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
  latest_article_at: string | null;
  age_minutes: number | null;
  verification: string;
  verification_note: string;
  confidence: string;
  source_count: number;
  sources: string[];
  impact: {
    attention_score: number;
    label: string;
    tone: string;
    severity: number;
    note: string;
  };
  affected_assets: { symbol: string; expected_direction: string; confidence: string }[];
  transmission_channels: string[];
  articles: NewsArticle[];
  data_origin: string;
  price_confirmation: PriceConfirmation;
}

export interface PriceConfirmationAsset {
  symbol: string;
  expected_direction: string | null;
  quote_change: number | null;
  state: string;
  quote_source: string | null;
}

export interface PriceConfirmation {
  status: string;
  label: string;
  assets: PriceConfirmationAsset[];
  quote_freshness: string;
  as_of: string | null;
  fetched_at: string | null;
  note: string;
}

export interface ScenarioPriceCheck {
  label: string;
  passed: boolean | null;
  detail: string;
}

export interface ScenarioPriceConfirmation {
  status: string;
  label: string;
  checks: ScenarioPriceCheck[];
  passed: number;
  total: number;
  quote_change: number | null;
  as_of: string | null;
  source: string | null;
  note: string;
}

export interface NewsResponse {
  events: NewsEvent[];
  meta: FeedMeta;
  categories: { key: string; label: string }[];
  errors: Record<string, string>;
  note: string;
}

export interface ScenarioPlan {
  side: string;
  label: string;
  status: string;
  trigger: string;
  entry_zone: number[] | null;
  stop: number | null;
  targets: number[];
  invalidation: string;
  gross_risk_reward: number | null;
  net_risk_reward: number | null;
  caption?: string;
  evidence: string[];
  confidence: number;
  notes: string;
}

export interface ScenarioPattern {
  close: number;
  e20: number | null;
  e50: number | null;
  e200: number | null;
  rsi: number | null;
  atr: number | null;
  macd_hist: number | null;
  high20: number;
  low20: number;
  high52: number;
  low52: number;
  score: number;
  trend: string;
  pivot: { p: number; r1: number; r2: number; s1: number; s2: number };
}

export interface BankNiftyScenario {
  available: boolean;
  reason?: string;
  symbol?: string;
  name?: string;
  generated_at?: string;
  bias?: string;
  confidence?: number;
  confidence_label?: string;
  pattern?: ScenarioPattern;
  macro_tilt?: number;
  news_tilt?: number;
  price_confirmation?: ScenarioPriceConfirmation;
  scenarios?: ScenarioPlan[];
  active_scenario?: string;
  no_trade?: boolean;
  no_trade_reasons?: string[];
  news_watch?: {
    headline: string;
    event_label: string;
    tone: string;
    verification: string;
    published_at: string | null;
    attention_score: number;
    mapped_direction: string[];
    price_confirmation: string;
  }[];
  evidence?: string[];
  data_quality?: {
    chart_meta: FeedMeta;
    quote_meta: FeedMeta;
    news_meta: FeedMeta;
    bars: number;
    feed_age_seconds: number | null;
    holiday_calendar: string;
  };
  assumptions?: Record<string, unknown>;
  disclaimer?: string;
}

export interface MacroInstrumentGroup {
  key: string;
  label: string;
  keys: string[];
  context: string;
  instruments: Quote[];
}

export interface CorrelationEntry {
  correlation: number | null;
  sample: number;
  state: string;
  window: string;
  note: string;
}

export interface FlowSummary {
  category: string;
  net: number;
  buy: number;
  sell: number;
  unit: string;
  direction: string;
}

export interface FlowRow {
  category: string;
  date: string;
  buy: number;
  sell: number;
  net: number;
  unit: string;
}

export interface FlowsResponse {
  available: boolean;
  rows: FlowRow[];
  summary: FlowSummary[];
  reported_date: string | null;
  unit: string;
  source_url: string | null;
  meta: FeedMeta;
  note: string;
  fetched_at: string;
}

export interface TransmissionNote {
  channel: string;
  observation: string;
  watch: string;
  effect: string;
  confirm: string;
  invalidate: string;
  confidence: string;
}

export interface MacroResponse {
  groups: MacroInstrumentGroup[];
  quotes: Quote[];
  correlations: Record<string, CorrelationEntry>;
  correlation_meta: FeedMeta;
  risk_regime: {
    label: string;
    score: number;
    contributors: { key: string; change: number; weight: number }[];
    note: string;
  };
  transmission_notes: TransmissionNote[];
  flows?: FlowsResponse;
  macro_meta: FeedMeta;
  as_of: string;
  note: string;
}

export interface LagPoint {
  t: number;
  value: number;
}

export interface LagProfileEntry {
  lag_seconds: number;
  correlation: number;
  n: number;
}

export interface LagResult {
  state: string;
  origin?: string;
  reason?: string;
  bucket_seconds?: number;
  max_lag_seconds?: number;
  best_lag?: {
    anchor_leads_by_seconds: number;
    correlation: number;
    n: number;
    ci95: (number | null)[];
  };
  profile?: LagProfileEntry[];
  aligned_observations?: number;
  anchor_points?: number;
  response_points?: number;
  interpretation?: string;
  warnings?: string[];
  method?: { summary: string; min_observations: number; sample_size_warning: string };
}

export interface LagDemo {
  origin: "simulated";
  anchor_label: string;
  response_label: string;
  anchor: LagPoint[];
  response: LagPoint[];
  bucket_seconds: number;
  planted_lag_seconds: number;
  requested_lag_seconds: number;
  warning: string;
}

export interface PolymarketStatus {
  available: boolean;
  state: string;
  detail: string;
  gamma_url: string;
  clob_url: string;
  sample_count?: number;
}

export interface PaperTrade {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  entry_at: string;
  exit_price: number | null;
  exit_at: string | null;
  status: "OPEN" | "CLOSED";
  stop_loss: number | null;
  take_profit: number | null;
  entry_fee: number;
  exit_fee: number;
  realized_pnl: number | null;
  notes: string | null;
  quote_source: string | null;
  exit_quote_source: string | null;
  risk_snapshot_json: string | null;
}

export interface RiskLimitCheck {
  key: string;
  label: string;
  used: number;
  limit: number;
  state: string;
}

export interface RiskLimits {
  max_open_positions: number;
  max_trade_notional: number;
  max_total_exposure: number;
  daily_loss_limit: number;
  max_drawdown: number;
  paper_slippage_bps: number;
  paper_fee_bps: number;
  paper_kill_switch: boolean;
  live_execution_enabled: boolean;
  requested_live_execution: boolean;
  mode: string;
  source: string;
}

export interface RiskSnapshot {
  mode: string;
  live_execution_enabled: boolean;
  kill_switch: boolean;
  limits: RiskLimits;
  limit_checks: { checks: RiskLimitCheck[]; blocked: boolean; hard_block_reasons: string[] };
  open_positions: number;
  gross_exposure: number;
  unrealized_pnl: number;
  realized_pnl_today: number;
  day_pnl: number;
  realized_drawdown: number;
  marks: {
    trade_id: number;
    symbol: string;
    mark: number;
    notional: number;
    unrealized_pnl: number;
    quote_source: string;
    quote_freshness: string;
  }[];
  quote_meta: FeedMeta;
  audit_chain_valid: boolean;
  warnings: string[];
  as_of: string;
}

export interface TradeResponse {
  trade: PaperTrade;
  simulated_fill: number;
  notional: number;
  fees: number;
  quote_meta: FeedMeta;
  risk: RiskSnapshot;
  warnings: string[];
}

export interface CloseResponse {
  trade: PaperTrade;
  gross_pnl: number;
  fees: number;
  realized_pnl: number;
  quote_meta: FeedMeta;
  risk: RiskSnapshot;
  warnings: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  payload_json: string;
  prev_hash: string;
  hash: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
  chain_valid: boolean;
  note: string;
}

export interface LicensedExchangeEntitlement {
  name: string;
  data_delay_seconds: number | null;
  allowed_instruments: number | null;
}

export interface LicensedEntitlement {
  enabled: boolean;
  expires_at: string | null;
  exchanges: LicensedExchangeEntitlement[];
  functions: { name: string; enabled: boolean }[];
  allowed_calls_per_hour: number | null;
  allowed_instruments: number | null;
}

export interface LiveStatus {
  vendor: string;
  configured: boolean;
  enabled: boolean;
  state: string;
  detail: string;
  base_host: string | null;
  has_api_key: boolean;
  license_scope: string;
  transport: string;
  source_type: "live" | "delayed" | "unknown" | string;
  delay_seconds: number | null;
  live_capable: boolean;
  entitlement: LicensedEntitlement | null;
  last_checked_at: string | null;
  last_error: string | null;
  capabilities: string[];
  limitations: string[];
  live_execution_enabled: boolean;
}

export interface SourceDefinition {
  key: string;
  name: string;
  category: string;
  capabilities: string[];
  access: string;
  freshness: string;
  status: string;
  health: {
    name: string;
    status: string;
    last_success_at: string | null;
    last_error_at: string | null;
    last_error: string | null;
    latency_ms: number | null;
    successes: number;
    failures: number;
  } | null;
  notes: string | null;
  detail?: LiveStatus | PolymarketStatus | { state?: string; available?: boolean } | null;
  live_execution_enabled?: boolean;
}

export interface SourceCatalog {
  sources: SourceDefinition[];
  provider_health: SourceDefinition["health"][];
  live_execution_enabled: boolean;
  risk_limits: RiskLimits;
  audit_chain_valid: boolean;
  generated_at: string;
  policy: string;
}

export interface AlertRule {
  id: number;
  kind: "price_above" | "price_below" | "news_keyword";
  symbol: string | null;
  threshold: number | null;
  keyword: string | null;
  note: string | null;
  enabled: boolean;
  created_at: string;
  last_triggered_at: string | null;
  description: string;
}

export interface AlertTrigger {
  rule: AlertRule;
  evidence: {
    kind: string;
    symbol?: string;
    value?: number;
    threshold?: number;
    quote_source?: string;
    quote_freshness?: string;
    keyword?: string;
    matches?: {
      headline: string;
      event_label: string;
      published_at: string | null;
      verification: string;
      sources: { source: string; link: string | null }[];
    }[];
  };
}

export interface AlertsResponse {
  rules: AlertRule[];
  live_execution_enabled: boolean;
  note: string;
}

export interface AlertCheckResponse {
  checked_at: string;
  rules_checked: number;
  triggered: AlertTrigger[];
  errors: string[];
  cooldown_minutes: number;
  quote_meta: FeedMeta | null;
  note: string;
}

export interface QualityCheck {
  key: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export interface QualityCrossCheck {
  key: string;
  name: string;
  tradingview: {
    value: number | null;
    as_of: string | null;
    source: string;
    freshness: Freshness;
  };
  yahoo: {
    available: boolean;
    value: number | null;
    as_of: string | null;
    source: string;
    reason: string | null;
  };
  difference_pct: number | null;
  state: "consistent" | "watch" | "mismatch" | "unavailable";
  note: string;
}

export interface QualityResponse {
  overall: "ok" | "watch" | "degraded" | "unavailable";
  generated_at: string;
  live_execution_enabled: boolean;
  quote_meta: FeedMeta;
  licensed_feed: LiveStatus;
  cross_checks: QualityCrossCheck[];
  checks: QualityCheck[];
  provider_health: NonNullable<SourceDefinition["health"]>[];
  warnings: string[];
  note: string;
}

export interface EconomicEvent {
  id: string;
  title: string;
  indicator: string | null;
  country: string;
  category: string | null;
  period: string | null;
  importance: number;
  importance_label: "high" | "medium" | "low";
  date: string;
  reference_date: string | null;
  actual: number | string | null;
  forecast: number | string | null;
  previous: number | string | null;
  unit: string | null;
  scale: string | null;
  currency: string | null;
  source: string | null;
  source_url: string | null;
  comment: string | null;
  status: "released" | "scheduled";
  ticker: string | null;
}

export interface EconomicCalendarResponse {
  available: boolean;
  events: EconomicEvent[];
  event_count?: number;
  upcoming_count?: number;
  next_high_impact: EconomicEvent | null;
  meta: FeedMeta;
  generated_at: string;
  reason?: string;
  window?: {
    days_back: number;
    days_forward: number;
    importance: string;
    countries: string[];
  };
  official_calendars: { name: string; url: string; note: string }[];
  disclaimer: string;
}

export interface BacktestMetrics {
  trades: number;
  win_rate_pct: number | null;
  average_win: number | null;
  average_loss: number | null;
  profit_factor: number | null;
  expectancy_per_trade: number | null;
  total_pnl: number;
  total_return_pct: number;
  max_drawdown: { amount: number; pct: number; peak: number | null; trough: number | null };
  final_equity: number;
  total_costs: number;
  sharpe: number | null;
  sharpe_note: string;
}

export interface BacktestTrade {
  entry_at: string;
  exit_at: string;
  entry_date: string;
  exit_date: string;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  return_pct: number;
  costs: number;
  bars_held: number;
}

export interface BacktestResult {
  available: boolean;
  reason?: string;
  strategy?: {
    name: string;
    symbol: string;
    name_label: string;
    range: string;
    execution: string;
    cost_bps_per_side: number;
    initial_capital: number;
    caveat: string;
  };
  metrics?: BacktestMetrics;
  trades?: BacktestTrade[];
  open_position?: Record<string, unknown> | null;
  equity_curve?: { date: string; equity: number }[];
  data_quality?: { bars: number; first_bar: string; last_bar: string; meta: FeedMeta };
  generated_at?: string;
  disclaimer?: string;
}

export interface BlackScholesResult {
  inputs: Record<string, string | number>;
  price: number;
  intrinsic_value: number;
  time_value: number;
  breakeven: number;
  greeks: {
    delta: number;
    gamma: number;
    vega_per_1pct_vol: number;
    theta_per_day: number;
  };
  interpretation: Record<string, string>;
  assumptions: string;
  limitations: string;
  generated_at: string;
}

export interface AppConfig {
  version: string;
  environment: string;
  live_execution_enabled: boolean;
  requested_live_execution: boolean;
  mode: string;
  risk_limits: RiskLimits;
  providers: {
    polymarket_enabled: boolean;
    polymarket_gamma_url: string;
    polymarket_clob_url: string;
    globaldatafeeds?: LiveStatus;
  };
  api_host: string;
  api_port: number;
  note: string;
}

export interface RiskSettingsResponse {
  limits: RiskLimits;
  editable: string[];
  live_execution_enabled: boolean;
  note: string;
}

export interface WatchlistItem {
  key: string;
  name: string;
  short: string;
  exchange: string;
  currency: string;
  value: number | null;
  change: number | null;
  as_of: string | null;
  added_at: string | null;
  note: string;
  error?: string | null;
}

export interface WatchlistResponse {
  watchlist: WatchlistItem[];
  count: number;
}

export interface ScannerMatch {
  key: string;
  name: string;
  short: string;
  exchange: string;
  price: number;
  change: number | null;
  condition: string;
  matched: boolean;
  provider: string;
}

export interface ScannerResponse {
  condition: string;
  interval: string;
  range: string;
  matches: ScannerMatch[];
  scanned: number;
  matched_count: number;
  as_of: string | null;
  note: string;
}

export interface ScannerCondition {
  key: string;
  label: string;
  description: string;
}

export interface IndexScanRow {
  key: string;
  name: string;
  short: string;
  exchange: string;
  category: string;
  currency: string;
  available: boolean;
  last_close?: number;
  previous_close?: number;
  day_change_pct?: number | null;
  year_change_pct?: number | null;
  high_52w?: number;
  low_52w?: number;
  pct_from_52w_high?: number | null;
  rsi14?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  trend?: string;
  atr14?: number | null;
  atr_pct?: number | null;
  signals_bullish_total?: number;
  signals_bearish_total?: number;
  signals_recent_bullish?: number;
  signals_recent_bearish?: number;
  last_signal?: string | null;
  last_signal_side?: string | null;
  bar_count?: number;
  spark_times?: number[];
  spark_closes?: number[];
}

export interface IndicesScannerResponse {
  available: boolean;
  scanned: number;
  returned: number;
  advancing_1y: number;
  declining_1y: number;
  advancing_today: number;
  declining_today: number;
  strongest: { key: string; name: string; year_change_pct: number | null } | null;
  weakest: { key: string; name: string; year_change_pct: number | null } | null;
  indices: IndexScanRow[];
  meta: Record<string, unknown>;
}
