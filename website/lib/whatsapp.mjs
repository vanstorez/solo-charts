import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAiPlan } from "./ai.mjs";
import { getMarketContext } from "./market.mjs";
import { getNewsFeed } from "./news.mjs";
import { getScan } from "./scanner.mjs";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = path.dirname(LIB_DIR);
const DATA_DIR = path.join(WEBSITE_DIR, "data");
const OUTBOX_FILE = path.join(DATA_DIR, "whatsapp-outbox.json");
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";
const MAX_MESSAGE = 3900;
const MAX_OUTBOX = 60;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

export function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  // The bot is India-first: a bare 10-digit number gets +91.
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

export function maskPhone(value) {
  const digits = normalizePhone(value) || String(value ?? "").replace(/\D/g, "");
  if (!digits) return "not set";
  return `+${digits.slice(0, 2)} ••••• ${digits.slice(-4)}`;
}

function provider() {
  const value = env("WHATSAPP_PROVIDER").toLowerCase();
  return value === "meta" || value === "twilio" ? value : "";
}

function templateConfig() {
  return {
    name: env("WHATSAPP_TEMPLATE_NAME"),
    language: env("WHATSAPP_TEMPLATE_LANGUAGE", "en"),
    variables: Math.max(1, Math.min(10, Number(env("WHATSAPP_TEMPLATE_VARIABLES", "4")) || 4)),
    useForDaily: env("WHATSAPP_USE_TEMPLATE", "0") === "1"
  };
}

export function getWhatsAppStatus() {
  const active = provider();
  const recipient = normalizePhone(env("WHATSAPP_TO"));
  const meta = {
    token: Boolean(env("WHATSAPP_TOKEN")),
    phoneNumberId: Boolean(env("WHATSAPP_PHONE_NUMBER_ID")),
    recipient: Boolean(recipient)
  };
  const twilio = {
    accountSid: Boolean(env("TWILIO_ACCOUNT_SID")),
    authToken: Boolean(env("TWILIO_AUTH_TOKEN")),
    from: Boolean(env("TWILIO_WHATSAPP_FROM")),
    recipient: Boolean(recipient)
  };
  const configured = active === "meta"
    ? meta.token && meta.phoneNumberId && meta.recipient
    : active === "twilio"
      ? twilio.accountSid && twilio.authToken && twilio.from && twilio.recipient
      : false;
  const missing = [];
  if (!active) missing.push("WHATSAPP_PROVIDER (meta or twilio)");
  if (active === "meta") {
    if (!meta.token) missing.push("WHATSAPP_TOKEN");
    if (!meta.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!meta.recipient) missing.push("WHATSAPP_TO");
  }
  if (active === "twilio") {
    if (!twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!twilio.from) missing.push("TWILIO_WHATSAPP_FROM");
    if (!twilio.recipient) missing.push("WHATSAPP_TO");
  }
  const template = templateConfig();
  return {
    configured,
    provider: active || null,
    providerLabel: active === "meta"
      ? "Meta WhatsApp Cloud API"
      : active === "twilio"
        ? "Twilio WhatsApp"
        : "Local draft outbox",
    recipientSet: Boolean(recipient),
    recipientMasked: maskPhone(recipient),
    template: {
      ...template,
      ready: Boolean(template.name)
    },
    dailyTime: env("WHATSAPP_DAILY_TIME", "08:00 IST"),
    envFile: "website/.env.local",
    missing,
    note: configured
      ? "WhatsApp delivery is configured. Sends use the server-side credentials; tokens are never returned to the browser."
      : "No provider credentials found. The bot will save the brief to the local outbox and will not send anything until WhatsApp Cloud API or Twilio is configured."
  };
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readOutbox() {
  try {
    const raw = await readFile(OUTBOX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_OUTBOX) : [];
  } catch {
    return [];
  }
}

async function pushOutbox(entry) {
  await ensureDataDir();
  const items = await readOutbox();
  items.unshift(entry);
  await writeFile(OUTBOX_FILE, JSON.stringify(items.slice(0, MAX_OUTBOX), null, 2), "utf8");
  return items[0];
}

export async function clearOutbox() {
  await ensureDataDir();
  await writeFile(OUTBOX_FILE, "[]\n", "utf8");
  return [];
}

function num(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function dateLabel(now = new Date()) {
  return now.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

export function formatWhatsAppBrief({ live = null, plan = null, scan = null, news = null, now = new Date() } = {}) {
  const lines = [];
  lines.push("🟢 *Solo Trading Charts*");
  lines.push(`_${dateLabel(now)} IST · research only_`);
  lines.push("");
  lines.push("*MARKET PULSE*");
  for (const [key, label] of [["NIFTY", "Nifty 50"], ["BANKNIFTY", "Bank Nifty"], ["SENSEX", "Sensex"]]) {
    const index = live?.indexes?.[key];
    if (!index) continue;
    lines.push(`${label}: *${num(index.spot)}* (${pct(index.change)})`);
  }
  const vix = live?.regime?.vix?.value;
  if (Number.isFinite(Number(vix))) lines.push(`India VIX: ${num(vix)} (${live?.regime?.vix?.label || "—"})`);
  if (live?.bias) lines.push(`Bias: *${live.bias}* · score ${live.score ?? "—"} · ${live.marketOpen ? "market open" : "market closed"}`);

  const sensex = live?.indexes?.SENSEX;
  if (sensex?.levels) {
    const supports = (sensex.levels.supports || []).slice(0, 2).map((value) => num(value, 0)).join(" / ");
    const resistances = (sensex.levels.resistances || []).slice(0, 2).map((value) => num(value, 0)).join(" / ");
    lines.push(`Sensex support: ${supports || "—"} · resistance: ${resistances || "—"}`);
  }

  const trade = plan?.trade;
  if (trade) {
    lines.push("");
    lines.push(`*AI PLAN · ${String(plan.name || "NIFTY").toUpperCase()}*`);
    lines.push(`${trade.side} · ${plan.bias?.label || "—"} · confidence ${plan.bias?.confidence ?? "—"}%`);
    lines.push(`Trigger: *${num(trade.trigger ?? trade.entry)}* · Stop: *${num(trade.stop)}*`);
    lines.push(`Targets: ${(trade.targets || []).map((value) => num(value)).join(" / ")}`);
    lines.push(`Risk: ₹${num(trade.riskAmount, 0)} · size: ${trade.lots ?? 0} lot(s)`);
    if (plan.option) {
      lines.push(`Option: *${plan.option.strategy}* · ${plan.option.expiry}`);
      lines.push(`Premium ${num(plan.option.premium)} · stop ${num(plan.option.stopPremium)} · target ${num(plan.option.targetPremium)}`);
    }
    if (plan.option?.riskExceedsBudget) {
      lines.push(`⚠️ One lot risks ₹${num(plan.option.riskAtStop, 0)} at the premium stop, above the ₹${num(trade.riskAmount, 0)} budget.`);
    }
  } else {
    lines.push("");
    lines.push("*AI PLAN*");
    lines.push("No plan available yet. Open the AI trader page to build one.");
  }

  const candidates = (scan?.items || [])
    .filter((item) => item.value != null && item.key !== "INDIAVIX")
    .slice()
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, 4);
  if (candidates.length) {
    lines.push("");
    lines.push("*SCANNER LEADERS*");
    for (const item of candidates) {
      lines.push(`${item.key}: ${num(item.value)} (${pct(item.change)}) · RSI ${num(item.rsi, 1)} · score ${item.score ?? "—"}`);
    }
  }

  const headlines = (news?.items || []).slice(0, 3);
  if (headlines.length) {
    lines.push("");
    lines.push("*HEADLINES*");
    for (const item of headlines) {
      lines.push(`• ${item.title} _(${item.source || "News"})_`);
    }
  }

  lines.push("");
  lines.push("_Solo Trading Charts is a research and paper-trading workspace. Not investment advice. No live orders are placed._");
  const text = lines.join("\n");
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1).trimEnd()}…` : text;
}

export function buildTemplateParams({ live = null, plan = null } = {}, now = new Date()) {
  const indexes = live?.indexes || {};
  const market = [
    `NIFTY ${num(indexes.NIFTY?.spot)} (${pct(indexes.NIFTY?.change)})`,
    `BANKNIFTY ${num(indexes.BANKNIFTY?.spot)} (${pct(indexes.BANKNIFTY?.change)})`,
    `SENSEX ${num(indexes.SENSEX?.spot)} (${pct(indexes.SENSEX?.change)})`,
    `VIX ${num(live?.regime?.vix?.value)}`
  ].join(" | ");
  const trade = plan?.trade;
  const planLine = trade
    ? `${trade.side} ${plan?.name || ""} · entry ${num(trade.trigger ?? trade.entry)} · stop ${num(trade.stop)} · T1 ${num(trade.targets?.[0])}`
    : "No AI plan available";
  const riskLine = trade
    ? `Risk ₹${num(trade.riskAmount, 0)} · ${trade.lots ?? 0} lot(s)${plan?.option ? ` · ${plan.option.strategy}` : ""}`
    : "Risk budget undefined";
  return [
    dateLabel(now),
    market.slice(0, 1024),
    planLine.slice(0, 1024),
    riskLine.slice(0, 1024)
  ];
}

export async function buildWhatsAppBundle({ symbol = "NIFTY", style = "intraday", capital = 100000, riskPct = 1, direction = "auto" } = {}) {
  const safe = (promise) => promise.catch(() => null);
  const [live, plan, scan, news] = await Promise.all([
    safe(getMarketContext()),
    safe(getAiPlan({ symbol, style, capital, riskPct, direction })),
    safe(getScan()),
    safe(getNewsFeed("all"))
  ]);
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    live,
    plan,
    scan,
    news,
    brief: formatWhatsAppBrief({ live, plan, scan, news, now }),
    templateParams: buildTemplateParams({ live, plan }, now)
  };
}

async function sendMeta({ recipient, text, mode, templateParams }) {
  const token = env("WHATSAPP_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const template = templateConfig();
  const useTemplate = (mode === "template" || (mode === "auto" && template.useForDaily)) && template.name;
  if (useTemplate && !templateParams.length) {
    throw new Error("Template mode needs templateParams. Use the daily script or pass params.");
  }
  let payload;
  if (useTemplate) {
    const params = templateParams.slice(0, template.variables).map((value) => ({
      type: "text",
      text: String(value ?? "").slice(0, 1024)
    }));
    payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(params.length ? { components: [{ type: "body", parameters: params }] } : {})
      }
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body: text }
    };
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.error_user_msg || data?.error?.message || `Meta API error ${response.status}`;
    throw new Error(detail);
  }
  return {
    mode: useTemplate ? "template" : "text",
    messageId: data?.messages?.[0]?.id || null,
    providerResponse: data
  };
}

async function sendTwilio({ recipient, text }) {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_WHATSAPP_FROM");
  const body = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: `whatsapp:+${recipient}`,
    Body: text
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Twilio API error ${response.status}`);
  return { mode: "text", messageId: data?.sid || null, providerResponse: data };
}

export async function deliverWhatsApp({ text, to = "", mode = "auto", templateParams = [] } = {}) {
  const recipient = normalizePhone(to || env("WHATSAPP_TO"));
  const message = String(text ?? "").trim();
  if (!message) throw new Error("WhatsApp message text is empty.");
  if (!recipient) throw new Error("WhatsApp recipient is not configured. Set WHATSAPP_TO in website/.env.local.");
  const status = getWhatsAppStatus();
  const entry = {
    id: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    provider: status.provider,
    toMasked: maskPhone(recipient),
    mode: mode === "template" ? "template" : "text",
    status: "queued",
    text: message.slice(0, 4500)
  };
  if (!status.configured) {
    entry.reason = "Provider not configured. Saved to the local outbox; nothing was sent.";
    await pushOutbox(entry);
    return {
      ok: false,
      queued: true,
      configured: false,
      status: "queued",
      message: entry.reason,
      entry,
      statusInfo: status
    };
  }
  try {
    const result = status.provider === "meta"
      ? await sendMeta({ recipient, text: message, mode, templateParams })
      : await sendTwilio({ recipient, text: message });
    entry.status = "sent";
    entry.mode = result.mode;
    entry.messageId = result.messageId || null;
    if (status.provider === "twilio" && mode === "template") entry.note = "Twilio delivery used a text message; templates are handled by Meta Cloud API.";
    await pushOutbox(entry);
    return {
      ok: true,
      queued: false,
      configured: true,
      status: "sent",
      mode: entry.mode,
      messageId: entry.messageId,
      entry,
      statusInfo: status
    };
  } catch (error) {
    entry.status = "failed";
    entry.error = error?.message || String(error);
    await pushOutbox(entry);
    return {
      ok: false,
      queued: false,
      configured: true,
      status: "failed",
      message: entry.error,
      entry,
      statusInfo: status
    };
  }
}
