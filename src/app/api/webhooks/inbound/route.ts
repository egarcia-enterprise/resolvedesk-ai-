import { NextRequest, NextResponse } from "next/server";
import {
  createTicket,
  findTicketByExternalEventId,
  getOrganizationByApiKey,
  getOrganizationById,
  recordWebhookLog,
} from "@/lib/db";
import { processTicketWithAiGuardrails } from "@/lib/triage-service";
import type { TicketPriority } from "@/lib/types";

/**
 * POST /api/webhooks/inbound
 *
 * ENDPOINT DE INTEGRACIÓN MACHINE-TO-MACHINE (Estilo Zendesk Sunshine / Webhooks API)
 * Así es como el SAP ERP de Inditex, el Shopify de una marca retail o Stripe envían
 * incidencias automáticamente a Zendesk sin intervención humana:
 *
 * 1. Autenticación por `Authorization: Bearer zd_live_...` (o cabecera `x-api-key`).
 * 2. Resolución automática del Tenant (`organization_id`) a partir de la API Key.
 * 3. Control de Idempotencia (`external_event_id`) para evitar tickets duplicados en reintentos de red.
 * 4. Ejecución automática de Guardrail GDPR + Intelligent Triage IA.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const headerApiKey = request.headers.get("x-api-key") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : headerApiKey.trim();

  if (!token) {
    return NextResponse.json(
      {
        error:
          "HTTP 401 Unauthorized: Falta cabecera 'Authorization: Bearer <API_KEY>' o 'x-api-key'.",
        code: "MISSING_API_KEY",
      },
      { status: 401 }
    );
  }

  const org = getOrganizationByApiKey(token);
  if (!org) {
    return NextResponse.json(
      {
        error:
          "HTTP 401 Unauthorized: API Key inválida o revocada. Verifica la clave en Admin Center.",
        code: "INVALID_API_KEY",
      },
      { status: 401 }
    );
  }

  const body = await request.json();
  const {
    source_system = "External ERP Webhook",
    external_event_id,
    customer_name,
    customer_email,
    subject,
    message,
    priority = "high",
    gemini_api_key,
  } = body as {
    source_system?: string;
    external_event_id?: string;
    customer_name?: string;
    customer_email?: string;
    subject?: string;
    message?: string;
    priority?: TicketPriority;
    gemini_api_key?: string;
  };

  if (!customer_name || !customer_email || !subject || !message) {
    return NextResponse.json(
      {
        error:
          "Payload JSON incompleto: se requieren customer_name, customer_email, subject y message.",
      },
      { status: 400 }
    );
  }

  // CONTROL DE IDEMPOTENCIA: si el ERP reintenta el mismo evento, NO duplicamos el ticket ni cobramos doble IA
  if (external_event_id) {
    const existingTicket = findTicketByExternalEventId(
      org.id,
      external_event_id
    );
    if (existingTicket) {
      const log = recordWebhookLog({
        organization_id: org.id,
        source_system,
        external_event_id,
        status_code: 200,
        outcome: "IDEMPOTENT_SKIP (Evento duplicado ignorado)",
        ticket_number: existingTicket.ticket_number,
      });

      return NextResponse.json(
        {
          idempotent_duplicate: true,
          message: `Evento '${external_event_id}' ya fue procesado anteriormente en ${existingTicket.ticket_number}. No se creó duplicado ni se consumió cuota IA adicional.`,
          ticket: existingTicket,
          organization: getOrganizationById(org.id, false),
          webhook_log: log,
          _debug: {
            endpoint: "POST /api/webhooks/inbound (200 Idempotent)",
            sql: `SELECT * FROM tickets WHERE organization_id='${org.id}' AND external_event_id='${external_event_id}'; -- Duplicado bloqueado`,
          },
        },
        { status: 200 }
      );
    }
  }

  let ticket = createTicket({
    organization_id: org.id,
    channel: "api",
    requester_name: customer_name,
    requester_email: customer_email,
    subject,
    description: message,
    priority,
    external_event_id: external_event_id ?? null,
  });

  let triageWarning: string | null = null;
  try {
    const triaged = await processTicketWithAiGuardrails(
      org.id,
      ticket.id,
      gemini_api_key
    );
    ticket = triaged.ticket;
  } catch (err) {
    triageWarning =
      err instanceof Error ? err.message : "Aviso en auto-triaje de webhook.";
  }

  const log = recordWebhookLog({
    organization_id: org.id,
    source_system,
    external_event_id: external_event_id ?? null,
    status_code: 201,
    outcome: triageWarning
      ? "CREATED_WITHOUT_AI (Cuota agotada)"
      : "CREATED_AND_AI_TRIAGED",
    ticket_number: ticket.ticket_number,
  });

  return NextResponse.json(
    {
      idempotent_duplicate: false,
      ticket,
      organization: getOrganizationById(org.id, false),
      triageWarning,
      webhook_log: log,
      _debug: {
        endpoint: "POST /api/webhooks/inbound (201 Created)",
        sql: `SELECT id FROM organizations WHERE api_key='***'; INSERT INTO tickets (..., external_event_id) VALUES (..., '${
          external_event_id ?? "NULL"
        }');`,
      },
    },
    { status: 201 }
  );
}
