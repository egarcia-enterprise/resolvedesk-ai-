# ResolveDesk AI — Multi-Tenant Agentic Operations & Process Orchestration Platform

[![Live Demo](https://img.shields.io/badge/Live%20Interactive%20Demo-Launch%20Workspace-10B981?style=for-the-badge)](https://egarcia-enterprise.github.io/resolvedesk-ai-/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/Database-Multi--Tenant%20SQLite-003B57?style=for-the-badge)](https://www.sqlite.org/)

> ### 🌐 **[Click here to open the Live Interactive Demo in your browser →](https://egarcia-enterprise.github.io/resolvedesk-ai-/)**
> *Test Multi-Tenant switching (`Moda Ibérica Retail` vs `PayFlow Digital`), GDPR PII Masking, AI Triage, 1-Click Agent Copilot, and the Live SQL Query Inspector without installing anything locally.*

**ResolveDesk AI** is a full-stack B2B SaaS prototype designed to demonstrate how **Agentic AI, intelligent process orchestration, and human-in-the-loop expertise** transform high-volume enterprise operations across Retail, FinTech, and B2B Services.

Built by **Enrique García** ([LinkedIn](https://linkedin.com/in/enriquegarciacollado) · [Enterprise Value Hub](https://egarcia-enterprise.github.io/egarcia-enterprise/)).

---

## 🚀 Key Enterprise Capabilities

1. **Multi-Tenant Data Isolation & Consumption Metering (`organization_id`)**
   * Strict tenant-level SQL isolation across organizations (*Retail Omnichannel*, *FinTech Payments*, *B2B Cloud*).
   * Tracks seat limits, MRR (`mrr_eur`), and **consumption-based AI resolution credits** (`ai_resolutions_used / ai_resolutions_limit`) across `starter` and `enterprise` tiers.

2. **Autonomous AI Triage & Trust Layer (PII Redaction)**
   * **Automated PII Redaction (`redacted_description`):** Masks sensitive customer data (credit cards, IBANs, national IDs, emails) before LLM processing.
   * **Intent & Sentiment Classification:** Automatically categorizes incoming operational requests and assigns SLA priority (`Urgent 1h`, `High 4h`, `Normal 24h`).
   * **Agentic Resolution Drafting (`ai_suggested_reply`):** Generates context-aware resolutions ready for one-click human approval or autonomous execution.

3. **Omnichannel Ingestion & Human-in-the-Loop Workspace (`AgentWorkspace.tsx`)**
   * Unified operational queue across **WhatsApp**, **Email**, **Web Center**, and **Webhook API**.
   * Real-time **REST API & SQL Query Inspector (`DebugLog`)** allowing technical buyers (CTOs/Solution Architects) to inspect the underlying multi-tenant queries and API payloads live.

---

## 🛠️ Tech Stack

* **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
* **Backend:** Next.js Route Handlers (`/api/organizations`, `/api/tickets`), RESTful JSON APIs
* **Database:** Relational SQL (`node:sqlite`) with multi-tenant schema (`organizations`, `users`, `tickets`)

---

## 🌐 Live Interactive Demo

👉 **Launch in Browser (No installation required):** [**https://egarcia-enterprise.github.io/resolvedesk-ai-/**](https://egarcia-enterprise.github.io/resolvedesk-ai-/)

### 💻 Local Development (Next.js + SQLite Backend)

```bash
npm install
npm run dev
```
