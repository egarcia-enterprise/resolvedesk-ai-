import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createTicket, getOrganizationById, listTicketsByOrg } from "@/lib/db";
import { processTicketWithAiGuardrails } from "@/lib/triage-service";
import type { TicketChannel, TicketPriority } from "@/lib/types";

/**
 * GET /api/tickets?status=all
 * SEGURIDAD MULTI-TENANT REAL: el servidor extrae `organizationId` del token firmado
 * en la cookie HttpOnly `rd_session` (nunca confía ciegamente en parámetros de la URL).
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Sesión no iniciada (HTTP 401). Accede mediante el portal SSO." },
      { status: 401 }
    );
  }

  const orgId = session.organizationId;
  const status = request.nextUrl.searchParams.get("status") ?? "all";

  const organization = getOrganizationById(orgId, false);
  if (!organization) {
    return NextResponse.json(
      { error: "Organización no encontrada." },
      { status: 404 }
    );
  }

  const tickets = listTicketsByOrg(orgId, status);
  const sqlFilter =
    status && status !== "all"
      ? `SELECT * FROM tickets WHERE organization_id = '${orgId}' AND status = '${status}' ORDER BY created_at DESC;`
      : `SELECT * FROM tickets WHERE organization_id = '${orgId}' ORDER BY created_at DESC;`;

  return NextResponse.json({
    organization,
    tickets,
    _debug: {
      endpoint: `GET /api/tickets (Cookie Session: ${orgId})`,
      sql: sqlFilter,
    },
  });
}

/**
 * POST /api/tickets
 * Crea un ticket dentro del Tenant autenticado en la sesión y opcionalmente ejecuta Auto-Triaje IA.
 */
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Sesión no iniciada (HTTP 401)." },
      { status: 401 }
    );
  }

  const organization_id = session.organizationId;
  const body = await request.json();
  const {
    channel = "web",
    requester_name,
    requester_email,
    subject,
    description,
    priority = "normal",
    auto_triage = true,
    gemini_api_key,
  } = body as {
    channel?: TicketChannel;
    requester_name?: string;
    requester_email?: string;
    subject?: string;
    description?: string;
    priority?: TicketPriority;
    auto_triage?: boolean;
    gemini_api_key?: string;
  };

  if (
    !requester_name?.trim() ||
    !requester_email?.trim() ||
    !subject?.trim() ||
    !description?.trim()
  ) {
    return NextResponse.json(
      { error: "Todos los campos obligatorios deben estar completos." },
      { status: 400 }
    );
  }

  let ticket = createTicket({
    organization_id,
    channel,
    requester_name: requester_name.trim(),
    requester_email: requester_email.trim(),
    subject: subject.trim(),
    description: description.trim(),
    priority,
  });

  let updatedOrg = getOrganizationById(organization_id, false)!;
  let triageWarning: string | null = null;

  if (auto_triage) {
    try {
      const triaged = await processTicketWithAiGuardrails(
        organization_id,
        ticket.id,
        gemini_api_key
      );
      ticket = triaged.ticket;
      updatedOrg = triaged.organization;
    } catch (err) {
      triageWarning =
        err instanceof Error
          ? err.message
          : "No se pudo completar el auto-triaje IA.";
    }
  }

  return NextResponse.json(
    {
      ticket,
      organization: updatedOrg,
      triageWarning,
      _debug: {
        endpoint: "POST /api/tickets",
        sql: `INSERT INTO tickets (id, organization_id, ticket_number, channel, status, intent) VALUES ('${ticket.id}', '${organization_id}', '${ticket.ticket_number}', '${channel}', 'new', ${
          ticket.intent ? `'${ticket.intent}'` : "NULL"
        });`,
      },
    },
    { status: 201 }
  );
}
