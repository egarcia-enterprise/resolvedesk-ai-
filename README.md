# ResolveDesk AI — Multi-Tenant Agentic CX, Webhook Orchestration & Usage Billing Platform

[![Live Demo](https://img.shields.io/badge/Live%20Interactive%20Demo-Launch%20Workspace-10B981?style=for-the-badge)](https://egarcia-enterprise.github.io/resolvedesk-ai-/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/Database-Multi--Tenant%20SQLite-003B57?style=for-the-badge)](https://www.sqlite.org/)

> ### 🌐 **[Click here to open the Live Interactive Demo in your browser →](https://egarcia-enterprise.github.io/resolvedesk-ai-/)**
> *Test Multi-Tenant switching (`Moda Ibérica Retail` vs `PayFlow Digital`), Enterprise SSO & RBAC (`ADMIN` vs `AGENT`), GDPR PII Guardrail, Gemini AI Triage, Webhook Idempotency (`SAP ERP` / `Payment Gateway`), Stripe Usage Billing, and the MEDDPICC CFO ROI Calculator directly in your browser.*

**ResolveDesk AI** is a full-stack B2B SaaS reference architecture designed to demonstrate how **Agentic AI, cryptographic multi-tenant governance, enterprise webhooks, and usage-based billing** transform high-volume operations across Retail, FinTech, and B2B Services.

Built by **Enrique García** ([LinkedIn](https://linkedin.com/in/enriquegarciacollado) · [Enterprise Value Hub](https://egarcia-enterprise.github.io/egarcia-enterprise/)).

---

## 🏗️ Enterprise Architecture & Core Modules

### 1. Multi-Tenant SQLite Isolation (`src/lib/db.ts`)
* Strict tenant-level SQL isolation (`WHERE organization_id = ?`) across organizations (*Moda Ibérica Retail* on Enterprise Plan vs. *PayFlow Digital* on Starter Plan).
* Relational schema covering `organizations`, `users`, `tickets`, `webhook_logs`, and `billing_events`.

### 2. Enterprise SSO & Role-Based Access Control (`SsoLoginPortal.tsx`, `src/lib/auth.ts`)
* Signed `HttpOnly` session cookies (`HMAC-SHA256`) embedding `organizationId` and `role` (`admin` vs `agent`).
* Server-side RBAC enforcement: `agent` users can triage and resolve tickets, while sensitive operations (API key rotation, Stripe plan upgrades) enforce `admin` privileges (`HTTP 403 Forbidden` on unauthorized attempts).

### 3. GDPR/PII Guardrail & Hybrid Gemini AI Triage (`pii-guardrail.ts`, `ai-triage.ts`)
* **Zero-Leakage PII Redaction:** Regex + entity guardrail automatically masks emails, phone numbers, IBANs, credit cards, and Spanish DNI/NIE identifiers before any payload reaches the LLM.
* **Autonomous Triage Engine:** Supports live **Google Gemini (`gemini-2.5-flash`)** structured JSON output with deterministic fallback—classifying Intent, Sentiment/Churn Risk, SLA Priority (`Urgent 1h`, `High 4h`, `Normal 24h`), Executive Summary, and 1-Click Agent Copilot Reply.

### 4. Enterprise Webhook Integration Hub & Idempotency (`WebhookIntegrationHub.tsx`, `/api/webhooks/inbound`)
* Allows external enterprise systems (**SAP ERP / OMS**, **Stripe / Adyen Payment Gateways**) to push operational incidents via `X-Api-Key` authentication.
* **Idempotency Protection (`external_event_id`):** Prevents duplicate ticket creation during network retries (`HTTP 200 Idempotent Skip`) and logs all inbound events in `webhook_logs`.

### 5. Usage-Based Billing, Stripe Webhooks & MEDDPICC CFO Calculator (`BillingAndRoiDashboard.tsx`, `stripe-billing.ts`)
* Tracks consumption-based **AI Resolution Credits** (`ai_resolutions_used / ai_resolutions_limit`) and blocks AI triage with `HTTP 402 Payment Required` when a Starter tenant exhausts its quota.
* Simulates signed **Stripe Checkout Webhooks (`HMAC-SHA256` `Stripe-Signature`)** for instant plan upgrades (`Starter` → `Enterprise`) and credit top-ups.
* Includes an interactive **MEDDPICC CFO Business Case Calculator** quantifying annual net savings, FTE capacity freed, and payback period.

---

## 🛠️ Tech Stack

* **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
* **Backend APIs:**
  * `POST /api/auth/login` & `POST /api/auth/logout` (HMAC-SHA256 Session Cookies)
  * `GET / POST /api/tickets` & `PATCH /api/tickets/[id]` (Multi-Tenant Ticket CRUD)
  * `POST /api/tickets/[id]/triage` (PII Redaction + Gemini 2.5 Flash Triage + Quota Metering)
  * `POST /api/webhooks/inbound` & `GET / POST /api/admin/api-keys` (API Key Auth + Idempotency)
  * `GET / POST /api/billing` (Stripe Signature Verification + Plan Upgrades)
* **Database:** Native Node.js SQLite (`node:sqlite`) with zero external DB server dependencies.

---

## 🌐 Live Interactive Demo & Local Setup

👉 **Launch in Browser (No installation required):** [**https://egarcia-enterprise.github.io/resolvedesk-ai-/**](https://egarcia-enterprise.github.io/resolvedesk-ai-/)

### 💻 Run Locally (Full Next.js + SQLite Backend)

```bash
npm install
npm run dev
# Open http://localhost:3000
```
