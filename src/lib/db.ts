import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Organization,
  Ticket,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  User,
} from "./types";

/**
 * CAPA DE BASE DE DATOS MULTI-TENANT (SQLite nativo)
 *
 * En un SaaS en producción (ej. Google Cloud SQL / PostgreSQL), la estructura de tablas
 * y las consultas SQL con `WHERE organization_id = ?` son exactamente iguales.
 * Guardamos una única conexión en `globalThis` para evitar reabrir el archivo en modo desarrollo.
 */

const globalForDb = globalThis as unknown as {
  __resolvedeskDb?: DatabaseSync;
};

function initSchemaAndSeed(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- 1. Tabla de Empresas Clientes (Tenants)
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
      created_at TEXT NOT NULL
    );

    -- 2. Tabla de Usuarios / Agentes con Control de Roles (RBAC)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- 3. Tabla de Tickets Omnicanal aislados por organization_id
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
      ai_suggested_reply TEXT,
      agent_reply TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Índice compuesto: en SaaS siempre indexamos primero por organization_id
    CREATE INDEX IF NOT EXISTS idx_tickets_org_status
      ON tickets (organization_id, status, created_at DESC);
  `);

  // Comprobar si ya existen datos semilla (Seed Data)
  const countRow = db
    .prepare("SELECT COUNT(*) as total FROM organizations")
    .get() as { total: number };

  if (countRow.total > 0) {
    return;
  }

  const now = new Date();
  const minutesAgo = (mins: number) =>
    new Date(now.getTime() - mins * 60 * 1000).toISOString();

  // Insertar 2 empresas (Tenants) con planes muy distintos para demostrar SaaS Multi-Tenancy
  const insertOrg = db.prepare(`
    INSERT INTO organizations (
      id, name, slug, industry, plan, seats_limit,
      ai_resolutions_used, ai_resolutions_limit, mrr_eur, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    minutesAgo(5000)
  );

  // Insertar usuarios (RBAC: Admin vs Agent)
  const insertUser = db.prepare(`
    INSERT INTO users (id, organization_id, name, email, role)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertUser.run("usr_1", "org_retail", "Laura Gómez (VP CX)", "lgomez@modaiberica.es", "admin");
  insertUser.run("usr_2", "org_retail", "Carlos Ruiz (Agente N1)", "cruiz@modaiberica.es", "agent");
  insertUser.run("usr_3", "org_fintech", "Marta Sanz (Head of Ops)", "msanz@payflow.io", "admin");
  insertUser.run("usr_4", "org_fintech", "Diego Martín (Soporte)", "dmartin@payflow.io", "agent");

  // Insertar tickets realistas (incluyendo datos personales PII para la Fase 2 de GDPR/IA)
  const insertTicket = db.prepare(`
    INSERT INTO tickets (
      id, organization_id, ticket_number, channel, requester_name, requester_email,
      subject, description, status, priority, agent_reply, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Tickets de Moda Ibérica Retail (Tenant 1)
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

  // Tickets de PayFlow Digital (Tenant 2 - completamente aislados de Moda Ibérica)
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
  }
  return globalForDb.__resolvedeskDb;
}

// ============================================================================
// CONSULTAS SQL MULTI-TENANT (Aislamiento estricto por organization_id)
// ============================================================================

export function listOrganizations(): Organization[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM organizations ORDER BY mrr_eur DESC")
    .all() as unknown as Organization[];
}

export function getOrganizationById(orgId: string): Organization | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM organizations WHERE id = ?")
    .get(orgId) as unknown as Organization | undefined;
}

export function listUsersByOrg(orgId: string): User[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM users WHERE organization_id = ? ORDER BY role ASC")
    .all(orgId) as unknown as User[];
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

export interface CreateTicketInput {
  organization_id: string;
  channel: TicketChannel;
  requester_name: string;
  requester_email: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
}

export function createTicket(input: CreateTicketInput): Ticket {
  const db = getDb();
  const id = `tkt_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  // Calcular número secuencial legible estilo Zendesk (#ZD-XXXX) por organización
  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM tickets WHERE organization_id = ?")
    .get(input.organization_id) as { count: number };

  const prefix = input.organization_id === "org_retail" ? 1038 : 2008;
  const ticketNumber = `#ZD-${prefix + countRow.count}`;

  db.prepare(`
    INSERT INTO tickets (
      id, organization_id, ticket_number, channel, requester_name, requester_email,
      subject, description, status, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
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
    now,
    now
  );

  return db
    .prepare("SELECT * FROM tickets WHERE id = ? AND organization_id = ?")
    .get(id, input.organization_id) as unknown as Ticket;
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
  // SEGURIDAD MULTI-TENANT: verificamos SIEMPRE que el ticket pertenezca a `orgId`
  const existing = db
    .prepare("SELECT * FROM tickets WHERE id = ? AND organization_id = ?")
    .get(ticketId, orgId) as unknown as Ticket | undefined;

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

  return db
    .prepare("SELECT * FROM tickets WHERE id = ? AND organization_id = ?")
    .get(ticketId, orgId) as unknown as Ticket;
}
