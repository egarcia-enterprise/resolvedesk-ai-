import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  BillingEvent,
  Organization,
  PiiDetection,
  Ticket,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  User,
  WebhookLog,
} from "./types";

/**
 * CAPA DE BASE DE DATOS MULTI-TENANT (SQLite nativo)
 */

const globalForDb = globalThis as unknown as {
  __resolvedeskDb?: DatabaseSync;
};

function ensureMigrations(db: DatabaseSync) {
  // Migración Fase 2: columnas IA y GDPR en tickets
  const ticketCols = db.prepare("PRAGMA table_info(tickets)").all() as Array<{
    name: string;
  }>;
  const tNames = new Set(ticketCols.map((c) => c.name));

  if (!tNames.has("ai_summary")) {
    db.exec("ALTER TABLE tickets ADD COLUMN ai_summary TEXT;");
  }
  if (!tNames.has("ai_engine")) {
    db.exec("ALTER TABLE tickets ADD COLUMN ai_engine TEXT;");
  }
  if (!tNames.has("pii_stats")) {
    db.exec("ALTER TABLE tickets ADD COLUMN pii_stats TEXT;");
  }
  if (!tNames.has("external_event_id")) {
    db.exec("ALTER TABLE tickets ADD COLUMN external_event_id TEXT;");
  }

  // Migración Fase 3: API Keys por Tenant + Tabla de Auditoría de Webhooks
  const orgCols = db
    .prepare("PRAGMA table_info(organizations)")
    .all() as Array<{ name: string }>;
  const oNames = new Set(orgCols.map((c) => c.name));

  if (!oNames.has("api_key")) {
    db.exec("ALTER TABLE organizations ADD COLUMN api_key TEXT;");
  }

  // Asignar claves API iniciales si alguna organización aún no tiene
  db.prepare(
    "UPDATE organizations SET api_key = 'zd_live_moda_9f8a7b6c5d4e' WHERE id = 'org_retail' AND (api_key IS NULL OR api_key = '')"
  ).run();
  db.prepare(
    "UPDATE organizations SET api_key = 'zd_live_payflow_1a2b3c4d5e6f' WHERE id = 'org_fintech' AND (api_key IS NULL OR api_key = '')"
  ).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_system TEXT NOT NULL,
      external_event_id TEXT,
      status_code INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      ticket_number TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_ext_event
      ON tickets (organization_id, external_event_id);

    -- Migración Fase 4: Historial auditable e idempotente de eventos Stripe Billing
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      stripe_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      amount_eur INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function initSchemaAndSeed(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      industry TEXT NOT NULL,
      plan TEXT NOT NULL CHECK (plan IN ('starter', 'enterprise')),
      seats_limit INTEGER NOT NULL DEFAULT 5,
      ai_resolutions_used INTEGER NOT NULL DEFAULT 0,
      ai_resolutions_limit INTEGER NOT NULL DEFAULT 10,
      mrr_eur INTEGER NOT NULL DEFAULT 0,
      api_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      ticket_number TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('email', 'web', 'whatsapp', 'api')),
      requester_name TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      redacted_description TEXT,
      status TEXT NOT NULL CHECK (status IN ('new', 'open', 'pending', 'solved')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      intent TEXT,
      sentiment TEXT,
      ai_summary TEXT,
      ai_suggested_reply TEXT,
      ai_engine TEXT,
      pii_stats TEXT,
      agent_reply TEXT,
      external_event_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_org_status
      ON tickets (organization_id, status, created_at DESC);
  `);

  const countRow = db
    .prepare("SELECT COUNT(*) as total FROM organizations")
    .get() as { total: number };

  if (countRow.total === 0) {
    const now = new Date();
    const minutesAgo = (mins: number) =>
      new Date(now.getTime() - mins * 60 * 1000).toISOString();

    const insertOrg = db.prepare(`
      INSERT INTO organizations (
        id, name, slug, industry, plan, seats_limit,
        ai_resolutions_used, ai_resolutions_limit, mrr_eur, api_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertOrg.run(
      "org_retail",
      "Moda Ibérica Retail",
      "moda-iberica",
      "Enterprise Retail & E-Commerce",
      "enterprise",
      150,
      42,
      500,
      4800,
      "zd_live_moda_9f8a7b6c5d4e",
      minutesAgo(10000)
    );

    insertOrg.run(
      "org_fintech",
      "PayFlow Digital",
      "payflow-digital",
      "FinTech & Pagos B2B",
      "starter",
      5,
      8,
      10,
      190,
      "zd_live_payflow_1a2b3c4d5e6f",
      minutesAgo(5000)
    );

    const insertUser = db.prepare(`
      INSERT INTO users (id, organization_id, name, email, role)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertUser.run("usr_1", "org_retail", "Laura Gómez (VP CX)", "lgomez@modaiberica.es", "admin");
    insertUser.run("usr_2", "org_retail", "Carlos Ruiz (Agente N1)", "cruiz@modaiberica.es", "agent");
    insertUser.run("usr_3", "org_fintech", "Marta Sanz (Head of Ops)", "msanz@payflow.io", "admin");
    insertUser.run("usr_4", "org_fintech", "Diego Martín (Soporte)", "dmartin@payflow.io", "agent");

    const insertTicket = db.prepare(`
      INSERT INTO tickets (
        id, organization_id, ticket_number, channel, requester_name, requester_email,
        subject, description, status, priority, agent_reply, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTicket.run(
      "tkt_r1",
      "org_retail",
      "#ZD-1041",
      "whatsapp",
      "Elena Navarro",
      "elena.navarro@gmail.com",
      "Cobro duplicado en pedido online #ES-99812 y nadie me responde",
      "Hola, hice una compra ayer de un abrigo por 189€ y me habéis cargado el importe dos veces en mi tarjeta terminada en 4532. Mi DNI es 48291044L y mi teléfono 644918273. Necesito el abono urgente hoy mismo o pondré reclamación en Consumo.",
      "new",
      "urgent",
      null,
      minutesAgo(14),
      minutesAgo(14)
    );

    insertTicket.run(
      "tkt_r2",
      "org_retail",
      "#ZD-1040",
      "email",
      "Javier Ortega",
      "j.ortega@empresa.es",
      "Cambio de talla en regalo corporativo (30 unidades)",
      "Buenos días equipo, recibimos el lote para nuestro evento en Madrid pero 8 chaquetas talla M vienen pequeñas. ¿Podemos gestionar recogida en Paseo de la Castellana 120 antes del viernes? Contacto directo: 611223344.",
      "open",
      "high",
      null,
      minutesAgo(68),
      minutesAgo(45)
    );

    insertTicket.run(
      "tkt_r3",
      "org_retail",
      "#ZD-1039",
      "web",
      "Sofía Morales",
      "sofia.m@hotmail.com",
      "Duda sobre plazo de devolución en tienda física",
      "Hola! Compré unos zapatos online la semana pasada. ¿Tengo 30 días para devolverlos gratis en cualquier tienda física llevando solo el código QR de la app?",
      "pending",
      "low",
      "Hola Sofía, ¡exacto! Tienes 30 días naturales desde la entrega mostrando el QR en caja. ¿Necesitas localizar tu tienda más cercana?",
      minutesAgo(240),
      minutesAgo(180)
    );

    insertTicket.run(
      "tkt_r4",
      "org_retail",
      "#ZD-1038",
      "api",
      "ERP Logística (Webhook)",
      "alerts@logistics-partner.com",
      "Retraso transportista ruta Zona Centro - 14 envíos Express",
      "Alerta automática de transportista: incidencia meteorológica afecta a 14 pedidos con SLA 24h en Madrid Centro. Requiere notificación proactiva a clientes VIP.",
      "solved",
      "normal",
      "Clientes VIP notificados automáticamente con cupón de compensación de gastos de envío.",
      minutesAgo(520),
      minutesAgo(400)
    );

    insertTicket.run(
      "tkt_f1",
      "org_fintech",
      "#ZD-2009",
      "api",
      "Clínica Dental Norte SL",
      "admin@clinicadentalnorte.es",
      "Error 502 en pasarela de cobro TPV Virtual en producción",
      "Urgente: nuestros pacientes no pueden pagar reservas desde las 16:30. El webhook devuelve HTTP 502. Nuestro comercio tiene NIF B87654321 y cuenta de liquidación ES91 2100 0418 4502 0005 1332. Estamos perdiendo citas cada minuto.",
      "new",
      "urgent",
      null,
      minutesAgo(8),
      minutesAgo(8)
    );

    insertTicket.run(
      "tkt_f2",
      "org_fintech",
      "#ZD-2008",
      "email",
      "Roberto Méndez",
      "rmendez@talleresmendez.com",
      "Solicitud de factura mensual de comisiones de octubre",
      "Hola, mi gestoría me pide el desglose de comisiones bancarias del mes pasado para cerrar el trimestre. ¿Desde qué menú del panel puedo descargarlo en PDF?",
      "open",
      "normal",
      null,
      minutesAgo(130),
      minutesAgo(120)
    );
  }

  ensureMigrations(db);
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__resolvedeskDb) {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "resolvedesk.sqlite");
    const db = new DatabaseSync(dbPath);
    initSchemaAndSeed(db);
    globalForDb.__resolvedeskDb = db;
  } else {
    ensureMigrations(globalForDb.__resolvedeskDb);
  }
  return globalForDb.__resolvedeskDb;
}

export function sanitizeOrgForRole(
  org: Organization,
  includeSecretKey = false
): Organization {
  if (includeSecretKey) {
    return org;
  }
  const copy = { ...org };
  delete copy.api_key;
  return copy;
}

// ============================================================================
// CONSULTAS SQL MULTI-TENANT, AUTH Y WEBHOOKS
// ============================================================================

export function listOrganizations(): Organization[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM organizations ORDER BY mrr_eur DESC")
    .all() as unknown as Organization[];
  return rows.map((o) => sanitizeOrgForRole(o, false));
}

export function getOrganizationById(
  orgId: string,
  includeSecretKey = false
): Organization | undefined {
  const db = getDb();
  const org = db
    .prepare("SELECT * FROM organizations WHERE id = ?")
    .get(orgId) as unknown as Organization | undefined;
  return org ? sanitizeOrgForRole(org, includeSecretKey) : undefined;
}

export function getOrganizationByApiKey(apiKey: string): Organization | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM organizations WHERE api_key = ?")
    .get(apiKey) as unknown as Organization | undefined;
}

export function rotateOrganizationApiKey(orgId: string): string | undefined {
  const db = getDb();
  const org = getOrganizationById(orgId, true);
  if (!org) return undefined;

  const prefix = orgId === "org_retail" ? "zd_live_moda_" : "zd_live_payflow_";
  const newKey = `${prefix}${crypto.randomBytes(6).toString("hex")}`;

  db.prepare("UPDATE organizations SET api_key = ? WHERE id = ?").run(
    newKey,
    orgId
  );
  return newKey;
}

export function listUsersByOrg(orgId: string): User[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM users WHERE organization_id = ? ORDER BY role ASC")
    .all(orgId) as unknown as User[];
}

export function getUserById(userId: string): User | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as unknown as User | undefined;
}

export function listTicketsByOrg(orgId: string, status?: string): Ticket[] {
  const db = getDb();
  if (status && status !== "all") {
    return db
      .prepare(
        "SELECT * FROM tickets WHERE organization_id = ? AND status = ? ORDER BY created_at DESC"
      )
      .all(orgId, status) as unknown as Ticket[];
  }
  return db
    .prepare(
      "SELECT * FROM tickets WHERE organization_id = ? ORDER BY created_at DESC"
    )
    .all(orgId) as unknown as Ticket[];
}

export function getTicketByIdAndOrg(
  orgId: string,
  ticketId: string
): Ticket | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tickets WHERE id = ? AND organization_id = ?")
    .get(ticketId, orgId) as unknown as Ticket | undefined;
}

export function findTicketByExternalEventId(
  orgId: string,
  externalEventId: string
): Ticket | undefined {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM tickets WHERE organization_id = ? AND external_event_id = ?"
    )
    .get(orgId, externalEventId) as unknown as Ticket | undefined;
}

export interface CreateTicketInput {
  organization_id: string;
  channel: TicketChannel;
  requester_name: string;
  requester_email: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
  external_event_id?: string | null;
}

export function createTicket(input: CreateTicketInput): Ticket {
  const db = getDb();
  const id = `tkt_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM tickets WHERE organization_id = ?")
    .get(input.organization_id) as { count: number };

  const prefix = input.organization_id === "org_retail" ? 1038 : 2008;
  const ticketNumber = `#ZD-${prefix + countRow.count}`;

  db.prepare(`
    INSERT INTO tickets (
      id, organization_id, ticket_number, channel, requester_name, requester_email,
      subject, description, status, priority, external_event_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)
  `).run(
    id,
    input.organization_id,
    ticketNumber,
    input.channel,
    input.requester_name,
    input.requester_email,
    input.subject,
    input.description,
    input.priority ?? "normal",
    input.external_event_id ?? null,
    now,
    now
  );

  return getTicketByIdAndOrg(input.organization_id, id)!;
}

export interface UpdateTicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  agent_reply?: string;
}

export function updateTicket(
  orgId: string,
  ticketId: string,
  patch: UpdateTicketPatch
): Ticket | undefined {
  const db = getDb();
  const existing = getTicketByIdAndOrg(orgId, ticketId);
  if (!existing) {
    return undefined;
  }

  const nextStatus = patch.status ?? existing.status;
  const nextPriority = patch.priority ?? existing.priority;
  const nextReply =
    patch.agent_reply !== undefined ? patch.agent_reply : existing.agent_reply;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE tickets
    SET status = ?, priority = ?, agent_reply = ?, updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(nextStatus, nextPriority, nextReply, now, ticketId, orgId);

  return getTicketByIdAndOrg(orgId, ticketId);
}

export function deleteTicketByOrg(orgId: string, ticketId: string): boolean {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM tickets WHERE id = ? AND organization_id = ?")
    .run(ticketId, orgId);
  return Number(res.changes) > 0;
}

export interface SaveAiTriageData {
  redactedDescription: string;
  intent: string;
  sentiment: string;
  recommendedPriority: TicketPriority;
  summary: string;
  suggestedReply: string;
  engine: string;
  detections: PiiDetection[];
}

export function saveTicketAiTriage(
  orgId: string,
  ticketId: string,
  data: SaveAiTriageData
): { ticket: Ticket; organization: Organization; consumedCredit: boolean } | undefined {
  const db = getDb();
  const existing = getTicketByIdAndOrg(orgId, ticketId);
  const org = getOrganizationById(orgId);
  if (!existing || !org) {
    return undefined;
  }

  const isFirstTriage = !existing.intent;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE tickets
    SET redacted_description = ?,
        intent = ?,
        sentiment = ?,
        priority = ?,
        ai_summary = ?,
        ai_suggested_reply = ?,
        ai_engine = ?,
        pii_stats = ?,
        updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(
    data.redactedDescription,
    data.intent,
    data.sentiment,
    data.recommendedPriority,
    data.summary,
    data.suggestedReply,
    data.engine,
    JSON.stringify(data.detections),
    now,
    ticketId,
    orgId
  );

  if (isFirstTriage) {
    db.prepare(`
      UPDATE organizations
      SET ai_resolutions_used = ai_resolutions_used + 1
      WHERE id = ?
    `).run(orgId);
  }

  return {
    ticket: getTicketByIdAndOrg(orgId, ticketId)!,
    organization: getOrganizationById(orgId)!,
    consumedCredit: isFirstTriage,
  };
}

export function recordWebhookLog(entry: {
  organization_id: string;
  source_system: string;
  external_event_id: string | null;
  status_code: number;
  outcome: string;
  ticket_number: string | null;
}): WebhookLog {
  const db = getDb();
  const id = `wh_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO webhook_logs (
      id, organization_id, source_system, external_event_id,
      status_code, outcome, ticket_number, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.organization_id,
    entry.source_system,
    entry.external_event_id,
    entry.status_code,
    entry.outcome,
    entry.ticket_number,
    now
  );

  return {
    id,
    ...entry,
    created_at: now,
  };
}

export function listWebhookLogsByOrg(orgId: string): WebhookLog[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM webhook_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20"
    )
    .all(orgId) as unknown as WebhookLog[];
}

// ============================================================================
// FASE 4: STRIPE BILLING, IDEMPOTENCIA DE PAGOS Y MÉTRICAS EJECUTIVAS CX
// ============================================================================

export function findBillingEventByStripeId(
  stripeEventId: string
): BillingEvent | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM billing_events WHERE stripe_event_id = ?")
    .get(stripeEventId) as unknown as BillingEvent | undefined;
}

export function listBillingEventsByOrg(orgId: string): BillingEvent[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM billing_events WHERE organization_id = ? ORDER BY created_at DESC LIMIT 15"
    )
    .all(orgId) as unknown as BillingEvent[];
}

export function applyStripeBillingWebhook(params: {
  orgId: string;
  stripeEventId: string;
  packageId: "upgrade_enterprise" | "addon_100_ai";
  amountEur: number;
  description: string;
}): {
  organization: Organization;
  billingEvent: BillingEvent;
  idempotentDuplicate: boolean;
} {
  const db = getDb();
  const existingEvt = findBillingEventByStripeId(params.stripeEventId);
  if (existingEvt) {
    return {
      organization: getOrganizationById(params.orgId, false)!,
      billingEvent: existingEvt,
      idempotentDuplicate: true,
    };
  }

  if (params.packageId === "upgrade_enterprise") {
    db.prepare(`
      UPDATE organizations
      SET plan = 'enterprise',
          seats_limit = CASE WHEN seats_limit < 50 THEN 50 ELSE seats_limit END,
          ai_resolutions_limit = ai_resolutions_limit + 500,
          mrr_eur = CASE WHEN mrr_eur < 2450 THEN 2450 ELSE mrr_eur + 1200 END
      WHERE id = ?
    `).run(params.orgId);
  } else {
    db.prepare(`
      UPDATE organizations
      SET ai_resolutions_limit = ai_resolutions_limit + 100,
          mrr_eur = mrr_eur + 150
      WHERE id = ?
    `).run(params.orgId);
  }

  const id = `bill_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const eventType =
    params.packageId === "upgrade_enterprise"
      ? "customer.subscription.updated"
      : "checkout.session.completed";

  db.prepare(`
    INSERT INTO billing_events (
      id, organization_id, stripe_event_id, event_type, amount_eur, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.orgId,
    params.stripeEventId,
    eventType,
    params.amountEur,
    params.description,
    now
  );

  return {
    organization: getOrganizationById(params.orgId, false)!,
    billingEvent: {
      id,
      organization_id: params.orgId,
      stripe_event_id: params.stripeEventId,
      event_type: eventType,
      amount_eur: params.amountEur,
      description: params.description,
      created_at: now,
    },
    idempotentDuplicate: false,
  };
}

export function resetStarterPlanForDemo(orgId: string): Organization {
  const db = getDb();
  db.prepare(`
    UPDATE organizations
    SET plan = 'starter',
        seats_limit = 5,
        ai_resolutions_used = 8,
        ai_resolutions_limit = 10,
        mrr_eur = 190
    WHERE id = ?
  `).run(orgId);
  return getOrganizationById(orgId, false)!;
}

export interface ExecutiveCxMetrics {
  totalTickets: number;
  aiTriagedTickets: number;
  solvedTickets: number;
  urgentTickets: number;
  totalPiiBlocked: number;
  webhookTickets: number;
}

export function getExecutiveOrgMetrics(orgId: string): ExecutiveCxMetrics {
  const tickets = listTicketsByOrg(orgId, "all");
  let totalPiiBlocked = 0;

  for (const t of tickets) {
    if (t.pii_stats) {
      try {
        const list = JSON.parse(t.pii_stats) as PiiDetection[];
        for (const item of list) {
          totalPiiBlocked += item.count;
        }
      } catch {
        // ignorar JSON malformado
      }
    }
  }

  return {
    totalTickets: tickets.length,
    aiTriagedTickets: tickets.filter((t) => Boolean(t.intent)).length,
    solvedTickets: tickets.filter((t) => t.status === "solved").length,
    urgentTickets: tickets.filter((t) => t.priority === "urgent").length,
    totalPiiBlocked,
    webhookTickets: tickets.filter((t) => t.channel === "api").length,
  };
}
