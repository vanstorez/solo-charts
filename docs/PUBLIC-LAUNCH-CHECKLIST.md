# Solo Trading Charts — Public Launch & Compliance Checklist

> **Status:** working draft, kept local (not committed to the public repository).
> **Important:** This is an operational checklist, not legal advice. Every item marked ⚖️ must be confirmed with a SEBI-registered lawyer / chartered accountant and the exchanges before you charge money.
> **Last reviewed:** 5 November 2026.

---

## 0. First, decide what you are legally selling

This decision changes everything: data licences, SEBI registration, disclaimers and pricing.

| Model | What users get | Regulatory burden | Recommendation |
|---|---|---|---|
| **A. Education + paper trading** | Charts, indicators, scanners, simulated trades, daily brief. No specific buy/sell calls. | Lowest. Still needs data licences, terms, privacy, honest marketing. | **Start here.** |
| **B. Research / signals** | “Buy NIFTY above X”, bias scores presented as recommendations, model portfolios. | SEBI **Research Analyst (RA)** registration almost certainly required. | Add only after registration. |
| **C. Personalised advice** | Advice tailored to a user’s holdings, risk profile or goals. | SEBI **Investment Adviser (IA)** registration. Much heavier. | Avoid at launch. |
| **D. Brokerage / live execution** | Placing real orders. | Broker registration, exchange membership, algo rules, huge capital. | Do not attempt. |

**Your current app sits between A and B.** The page says “Market Signal — Actionable Conclusion” and shows a bias. For model A, rename this to **“Technical Conditions”** or **“Indicator Alignment”**, remove action language, and publish a methodology page. Even then, get a written legal opinion. ⚖️

**Paid-only is a choice, not a legal requirement.** Free users still cost data fees, so the practical model is:

- **Free:** end-of-day or delayed data, limited watchlist, paper trading.
- **Paid:** real-time/delayed licensed data, full scanner, alerts, exports.
- **Pro:** multiple portfolios, API, priority support.

---

## 1. The eight gates

```
1. Company & legal  →  2. Data licences  →  3. SEBI (if research)
        ↓                                            ↓
4. Product hardening  →  5. Billing  →  6. Security & privacy
        ↓
7. Marketing & claims  →  8. Private beta  →  Public launch
```

Do not open payments until gates 1, 2, 4, 5 and 6 are complete.

---

## 2. Gate 1 — Company, tax and legal documents

### Entity
- [ ] Choose **Proprietorship** (cheapest, personal liability), **LLP**, or **Private Limited** (recommended once you take subscriptions).
- [ ] Incorporate via MCA (SPICe+), obtain CIN, PAN, TAN.
- [ ] Open a current account in the company name.
- [ ] Register for **GST** (required for most SaaS above the threshold; 18% on services).
- [ ] Appoint a CA for bookkeeping, GST returns and annual filings.

### Brand
- [ ] Trademark search for “Solo Trading Charts” in class 9 (software) and class 36/41 (financial services/education). ⚖️
- [ ] File trademark application (₹4,500 government fee per class for individual/startup/MSME, plus attorney).
- [ ] Register the domain and matching social handles.
- [ ] **Do not** use “TradingView” in the product name, domain, logo or ad keywords.

### Documents to publish before charging
- [ ] Terms of Service
- [ ] Privacy Policy (Digital Personal Data Protection Act, 2023)
- [ ] Risk Disclosure (market risk, data delay, no guaranteed returns)
- [ ] Refund & Cancellation Policy
- [ ] Grievance Officer / contact page
- [ ] Data attribution page (exchange + vendor requirements)
- [ ] Cookie policy (if analytics/marketing cookies are used)
- [ ] Acceptable Use Policy (no scraping, no resale, no automated abuse)

### Internal policies (needed even before SEBI)
- [ ] Information security policy
- [ ] Incident response and breach notification
- [ ] Record retention (SEBI RA requires at least 5 years)
- [ ] Complaint handling and turnaround times
- [ ] Vendor register and data-licence register

---

## 3. Gate 2 — Market data licences (the critical path)

**You cannot legally charge users while displaying Yahoo Finance, public Binance endpoints, or scraped NSE/BSE data.** Public endpoints are for personal/informal use; commercial display and redistribution need contracts.

### 3.1 Indian data (NSE / BSE)

Options:
1. **Direct:** NSE Data & Analytics (`marketdata@nse.co.in`) and BSE data services.
2. **Authorised vendor:** TrueData, Global Datafeeds, or another NSE/BSE-authorised vendor.
3. **Broker API:** only for personal use unless the broker agreement explicitly permits commercial display.

Questions to ask every vendor:
- [ ] Real-time, snapshot, delayed or end-of-day?
- [ ] **Public display** rights on a website and a mobile app? (NSE treats them as separate delivery channels.)
- [ ] **Redistribution** to paying subscribers allowed? At what per-user fee?
- [ ] Fixed fee + variable fee per user per month?
- [ ] Historical data, corporate actions, indices, F&O, options Greeks?
- [ ] Storage, caching, derived-data and non-display rights?
- [ ] Audit and reporting obligations (user counts, usage logs)?
- [ ] Attribution and disclaimer requirements?
- [ ] Termination, SLA, outage and fallback terms?
- [ ] Is the vendor authorised for **both NSE and BSE**?

**Indicative NSE pricing (published domestic rates, effective 1 April 2026):**
- Per-user variable fees for analytics/real-time products are commonly in the **₹150–300 per user per month** range, depending on feed frequency.
- Fixed product fees apply in addition; **+50% of the fixed fee for every additional delivery channel** (website and app count separately).
- Delayed/EOD data is cheaper but still licensed.
- Exact quote depends on segment, latency and display rights. Confirm with NSE/vendor.

### 3.2 Global data
- [ ] Indices, FX, commodities, US yields: CME, ICE, LSEG, OPRA or a licensed aggregator.
- [ ] Budget realistically: major-venue real-time data can run **$10,000–$100,000+ per year**, plus per-user fees. Delayed/EOD is far cheaper.
- [ ] Do not assume “public website data” is free to redistribute. It is not.

### 3.3 Crypto
- [ ] Review Binance (or chosen exchange) API terms for commercial use and redistribution.
- [ ] Decide whether India VDA tax rules apply to any paid crypto feature (30% + 1% TDS on gains; display-only is different, but confirm with a CA). ⚖️

### 3.4 TradingView
- [ ] Remove the TradingView iframe from the paid product **unless you have written permission**. The embed is display-only and subject to their terms.
- [ ] Do not scrape TradingView data, indicators or symbols.
- [ ] Do not copy their layout, name, domain or branding.

### 3.5 Current code changes required
- [ ] Replace the Yahoo provider in paid paths with a licensed adapter.
- [ ] Keep Yahoo only for a free, clearly labelled “delayed/unknown” tier **if** its terms allow it; otherwise remove it entirely.
- [ ] Add a vendor adapter interface so NSE/BSE/global feeds can be swapped without rewriting the app.
- [ ] Store licence metadata, attribution and entitlement per user.
- [ ] Add per-user data entitlement checks (who is allowed to see real-time data).

---

## 4. Gate 3 — SEBI registration (only if you publish research/signals)

### RA vs IA
- **Research Analyst (RA):** research reports, recommendations, signals, model portfolios. No personalised advice.
- **Investment Adviser (IA):** advice tailored to a person’s finances/goals. Separate, heavier registration.
- **Education/paper trading only:** may avoid RA/IA, but the line is fact-specific. Get a written opinion. ⚖️

### RA eligibility (current framework)
- [ ] Applicant can be an individual, partnership, LLP, company or research entity.
- [ ] Graduate degree (or equivalent) + relevant NISM certification.
- [ ] **NISM-Series-XV: Research Analyst Certification Examination** (₹1,500; revised format from 20 January 2026: 80 one-mark questions + 5 case-based sets, 2 hours).
- [ ] Principal officer and persons associated with research must hold valid NISM certification.
- [ ] “Fit and proper” person criteria.
- [ ] Compliance officer / adequate infrastructure.
- [ ] **Deposit** (lien marked to RAASB/BSE), based on maximum clients in the previous financial year:
  - Up to 150 clients: **₹1,00,000**
  - 151–300: **₹2,00,000**
  - 301–1,000: **₹5,00,000**
  - Above 1,000: **₹10,00,000**
- [ ] There is **no net-worth/capital-adequacy requirement** for RAs under the current framework; the deposit replaces it.

### Fees (indicative, verify current)
- [ ] SEBI application fee: **₹2,000**
- [ ] Registration fee: **₹3,000** (individual/partnership) or **₹30,000** (body corporate/LLP)
- [ ] RAASB administration fees (separate; budget roughly ₹5,000–10,000 for the first five years)
- [ ] GST at 18% on fees
- [ ] NISM exam: ₹1,500
- [ ] Deposit: ₹1 lakh+ (refundable/lien marked, not a fee)

### Process
1. [ ] Pass NISM-Series-XV.
2. [ ] Prepare incorporation documents, KYC, qualification proofs, business plan, compliance policies.
3. [ ] Apply through the BSE RAASB portal / SEBI Intermediary Portal (Form A).
4. [ ] Pay application fee; respond to SEBI queries.
5. [ ] Pay registration fee and RAASB administration fee.
6. [ ] Submit the deposit (FD/liquid fund lien marked to RAASB).
7. [ ] Receive certificate; publish mandatory disclosures on the website.
8. [ ] Renew NISM certification before expiry (NISM-Series-XV-B renewal exam).

### Ongoing RA compliance
- [ ] Maintain records for at least **5 years**.
- [ ] Disclose financial interests, conflicts, compensation and **use of AI**.
- [ ] No guaranteed returns, no misleading performance claims.
- [ ] Segregate research from distribution where applicable.
- [ ] Complaint handling, annual compliance reports, SEBI inspections.
- [ ] If you use influencers: comply with SEBI’s finfluencer rules; regulated entities cannot freely associate with unregistered finfluencers. ⚖️

### If you choose the education-only route
- [ ] Written legal opinion that your output is education/tools, not research.
- [ ] Remove “buy/sell”, “target”, “actionable conclusion”, “signal” language.
- [ ] No model portfolios, no personalised alerts.
- [ ] No performance/return claims.
- [ ] Publish methodology and limitations.
- [ ] Re-review every marketing asset before launch.

---

## 5. Gate 4 — Product hardening (engineering checklist)

### Accounts and data
- [ ] User authentication (email/phone + OTP, or OAuth), password reset, session management.
- [ ] PostgreSQL for users, watchlists, alerts, paper trades, subscriptions, audit logs.
- [ ] Move the in-memory watchlist (`solo/services/api/app/services/watchlist.py`) to the database.
- [ ] Multi-tenant data isolation and row-level authorisation.
- [ ] Role-based admin console (support, refunds, entitlements, data overrides).
- [ ] Account deletion and data export (DPDP rights).

### Reliability
- [ ] Dockerise the API and web app.
- [ ] Reverse proxy with HTTPS, HTTP/2, gzip/brotli.
- [ ] Managed PostgreSQL + Redis; automated backups and restore drills.
- [ ] Health checks, uptime monitoring, error tracking (Sentry or similar).
- [ ] Rate limiting, request quotas and abuse detection.
- [ ] Graceful handling of vendor outages; show “unavailable”, never fabricate.
- [ ] Data freshness badges and provenance on every quote (already present — keep it).

### Accuracy and trust
- [ ] Publish the methodology for every score and indicator.
- [ ] Add a “track record” or “how to read this” page; do not imply predictive accuracy.
- [ ] Backtest results clearly labelled with assumptions, costs and sample size.
- [ ] Separate “observed data” from “heuristic interpretation”.
- [ ] Add a feedback/bug report channel.

### Mobile
- [ ] PWA install, offline shell, responsive tables.
- [ ] Test on low-end Android and slow WiFi.
- [ ] Reduce the 79-symbol global batch time or stream progressively.

---

## 6. Gate 5 — Billing and subscriptions

- [ ] Choose a payment gateway: **Razorpay** (India, GST invoices, UPI) or **Stripe** (international).
- [ ] Use hosted checkout; never store card data (PCI DSS scope reduction).
- [ ] Plans: monthly/annual, upgrade/downgrade, proration.
- [ ] Free trial with abuse prevention (one per user/device/payment method).
- [ ] GST-compliant invoices, place of supply, HSN/SAC code.
- [ ] RBI recurring-payment/e-mandate rules for auto-renewals; additional factor authentication where required.
- [ ] Dunning for failed payments, grace period, cancellation flow.
- [ ] Refund policy and chargeback handling.
- [ ] Entitlement service: payment webhook → plan → data permissions.
- [ ] Revenue analytics: MRR, ARR, churn, ARPU, refunds, failed payments.

### Pricing sanity check
Before setting a price, calculate:

```
Monthly cost per user =
  data licence per user
+ hosting/database share
+ payment gateway (~2–3%)
+ support
+ GST
+ margin
```

If real-time data costs ₹150–300/user/month before infrastructure, a ₹299 plan has thin margins. Test ₹499–999 for Pro and ₹1,499–2,999 for Pro+.

---

## 7. Gate 6 — Security and privacy

### Security
- [ ] HTTPS/HSTS, secure cookies, CSP, CORS allow-list.
- [ ] Secrets in a manager, never in git (`.env` already ignored).
- [ ] Dependency scanning and patching; lockfiles committed.
- [ ] Authentication rate limits, lockouts, OTP throttling.
- [ ] Least-privilege database and cloud roles.
- [ ] Audit logs for admin actions and entitlement changes.
- [ ] Backup encryption and restore testing.
- [ ] External penetration test before public launch.
- [ ] Incident response plan and status page.

### Privacy (DPDP Act, 2023)
- [ ] Notice: what data you collect, why, how long, who you share it with.
- [ ] Consent for marketing cookies/communications; easy withdrawal.
- [ ] Data minimisation: don’t collect PAN/Aadhaar unless legally required.
- [ ] Data-principal rights: access, correction, deletion, grievance.
- [ ] Grievance officer and response timelines.
- [ ] Breach notification process.
- [ ] Vendor/data-processor contracts.
- [ ] Retention schedule and secure deletion.

---

## 8. Gate 7 — Marketing, claims and TradingView

### The “TradingView credits” question — direct answer

**There is no TradingView programme that pays you for building a better or competing platform.** You cannot “claim credits” for competing.

What exists is a **TradingView affiliate/partner programme**:
- Commission on **new paid subscriptions** purchased through your referral link (historically 30%).
- 90-day cookie, monthly payouts via PayPal, new users only.
- Strict rules: no self-referrals, no bidding on TradingView brand keywords, no copying their design/name/domain, no misleading claims.

That programme is for **promoting TradingView**, not for selling Solo. It is not a funding strategy for a competitor, and mixing the two creates trademark and partner-rule problems.

### Marketing rules for Solo
- [ ] Never say “better than TradingView”, “TradingView killer”, or use their logo/name in ads, domains or product branding.
- [ ] Do not bid on “TradingView” keywords in Google/Meta ads.
- [ ] No guaranteed returns, “95% accuracy”, “sure shot”, or unverified performance claims.
- [ ] Show risk warnings and data-delay disclosures clearly.
- [ ] Disclose affiliate relationships if you use them.
- [ ] Use SEBI-compliant language if you are an RA/IA.
- [ ] Get every landing page and ad reviewed before spending money.

### Positioning that can actually win
Compete on **focus**, not breadth:
- India-first workflow: NSE/BSE, sectors, FII/DII, options, VIX, corporate actions.
- Clean, fast mobile experience.
- Transparent “why” behind every score.
- Paper trading and risk tools.
- Daily brief before market open.
- Fair price and honest data labels.

Do not try to match TradingView’s global symbol count, social network, or decades of charting features at launch.

---

## 9. Gate 8 — Private beta and launch

### Private beta (20–50 users)
- [ ] Invite-only accounts; collect feedback weekly.
- [ ] Measure activation (first watchlist, first analysis, first paper trade), retention and churn.
- [ ] Track data gaps, latency, failed symbols and support tickets.
- [ ] Run a paid pilot (small fee) to validate willingness to pay.
- [ ] Fix the top 10 usability issues before public launch.

### Operations
- [ ] Support email/WhatsApp with response targets.
- [ ] Status page and incident runbook.
- [ ] On-call rotation (even if it is just you).
- [ ] Refund and complaint workflow.
- [ ] Backup/restore drill.
- [ ] Monthly compliance and data-usage review.

### Launch sequence
1. [ ] Legal and data gates signed off.
2. [ ] Product and billing tested end-to-end.
3. [ ] Security review and pen test closed.
4. [ ] Beta feedback resolved.
5. [ ] Pricing and unit economics approved.
6. [ ] Marketing assets legally reviewed.
7. [ ] Soft launch to waitlist.
8. [ ] Public launch with a clear “paper trading / education” positioning.

---

## 10. Indicative costs (India, first year)

| Item | Low | High | Notes |
|---|---:|---:|---|
| Incorporation + CA/CS | ₹8,000 | ₹25,000 | Pvt Ltd; proprietorship cheaper |
| GST registration + filings | ₹0 | ₹20,000 | Annual compliance extra |
| Trademark (2 classes) | ₹9,000 | ₹40,000 | Government + attorney |
| Legal documents + RA/IA opinion | ₹50,000 | ₹2,00,000 | Terms, privacy, risk, policies |
| NISM XV exam | ₹1,500 | ₹5,000 | Prep material extra |
| SEBI RA fees (individual) | ₹5,000 | ₹15,000 | + 18% GST; body corporate ₹30,000+ |
| RA deposit | ₹1,00,000 | ₹10,00,000 | Lien marked; not a fee |
| NSE/BSE data | ₹1,00,000+ | ₹10,00,000+ | Fixed + per-user variable; real-time costs more |
| Global data | ₹1,00,000+ | ₹25,00,000+ | Venue-dependent; delayed/EOD cheaper |
| Cloud + monitoring | ₹60,000 | ₹4,80,000 | ₹5k–40k/month |
| Payment gateway | ~2–3% | ~3% | Per transaction |
| Marketing | ₹0 | ₹5,00,000+ | Start organic |

**Realistic first-year range:** ₹3–8 lakh for an individual, education-first, delayed-data beta; **₹15–30 lakh+** for a company with real-time multi-venue data. Treat these as planning estimates, not quotes.

---

## 11. Timeline (realistic)

| Weeks | Work |
|---|---|
| 0–2 | Decide model; engage lawyer/CA; request data quotes; trademark search; NISM prep |
| 2–6 | Incorporate/GST; legal documents; auth + PostgreSQL + billing |
| 4–10 | Data licence negotiation and adapter integration |
| 6–14 | SEBI RA process (if research model); compliance policies |
| 12–16 | Private beta (20–50 users); fix issues |
| 16–20 | Security review, pricing validation, marketing review |
| Month 5–6 | Public launch |

SEBI approval and vendor contracting can take longer. **Never launch paid research before registration.**

---

## 12. First 10 actions this week

1. [ ] Write a one-page decision: **education/paper-trading** vs **research/signals**.
2. [ ] Book a SEBI-securities lawyer and a CA for a 1-hour scoping call. ⚖️
3. [ ] Email NSE Data & Analytics, BSE, TrueData and Global Datafeeds for **commercial public-display** quotes (website + app, per-user pricing).
4. [ ] Start NISM-Series-XV preparation if the research route is likely.
5. [ ] Start incorporation and GST registration.
6. [ ] Run a trademark search for “Solo Trading Charts”; file if clear.
7. [ ] Remove the TradingView iframe from the paid build.
8. [ ] Replace Yahoo in paid paths with a licensed vendor adapter.
9. [ ] Add authentication + PostgreSQL + subscription entitlements to the app.
10. [ ] Draft Terms, Privacy, Risk Disclosure and Refund Policy.

---

## 13. Go / no-go checklist

- [ ] Signed data licence permits **public display and redistribution** to paying users.
- [ ] Website and mobile app are both covered as delivery channels.
- [ ] Written legal opinion on RA/IA applies to your exact product.
- [ ] SEBI RA registration granted (if research/signals).
- [ ] Terms, privacy, risk, refund and grievance pages published.
- [ ] Auth, database, billing and entitlements tested end-to-end.
- [ ] Backups and restore tested.
- [ ] Security review/pen test closed.
- [ ] No unlicensed Yahoo/Binance/scraped data in paid paths.
- [ ] No TradingView branding, embed or ad keywords.
- [ ] No guaranteed-return or unverified performance claims.
- [ ] Support, incident and refund processes live.
- [ ] Unit economics positive after data, infra, gateway and GST.
- [ ] GST invoices and recurring-payment mandates working.
- [ ] Beta feedback resolved.

---

## 14. Sources to verify before signing anything

- SEBI (Research Analysts) Regulations, 2014 (amended up to 10 October 2026):
  https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792127227860.pdf
- SEBI FAQs on Research Analysts (July 2025):
  https://www.sebi.gov.in/sebi_data/faqfiles/jul-2025/1753269723942.pdf
- SEBI Master Circular for Research Analysts (6 February 2026) — fee/deposit slabs, compliance.
- NISM — Prerequisites for Research Analyst:
  https://www.nism.ac.in/revamp-nism/sebi-regulations/prerequisites-for-becoming-a-sebi-registered-research-analyst
- NSE Data Usage and Data Sharing Policy:
  https://www.nseindia.com/static/market-data/nse-data-policy
- NSE Data & Analytics domestic pricing (effective 1 April 2026):
  https://nsearchives.nseindia.com/web/mediaattachment/2026-03/NSE_Pricing_file_-_Domestic_clients_20260309171343.pdf
- TrueData (authorised NSE/BSE/MCX vendor):
  https://www.truedata.in/
- TradingView Partner Program Rules:
  https://www.tradingview.com/partner-rules
- Digital Personal Data Protection Act, 2023 and rules — verify current enforcement status.
- RBI recurring-payment/e-mandate rules — verify current requirements with your payment gateway.

---

**Bottom line:** the software is the easy part. The licences, SEBI registration and honest marketing are the real launch. Build the education/paper-trading product first, get paying beta users with delayed data, and add research/signals only after RA registration and a signed data contract.
