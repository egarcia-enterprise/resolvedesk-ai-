import { NextRequest, NextResponse } from "next/server";
import { createTicket, getOrganizationById, listTicketsByOrg } from "@/lib/db";
import type { TicketChannel, TicketPriority } from "@/lib/types";

/**
 * GET /api/tickets?orgId=org_retail&status=all
 * Consulta Multi-Tenant: exige SIEMPRE orgId para aislar los datos de cada empresa cliente.
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId");
  const status = request.nextUrl.searchParams.get("status") ?? "all";

  if (!orgId) {
    return NextResponse.json(
      { error: "Falta el parámetro obligatorio orgId (aislamiento Multi-Tenant)." },
      { status: 400 }
    );
  }

  const organization = getOrganizationById(orgId);
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
      endpoint: `GET /api/tickets?orgId=${orgId}&status=${status}`,
      sql: sqlFilter,
    },
  });
}

/**
 * POST /api/tickets
 * Crea un nuevo ticket entrante (desde formulario web, WhatsApp, email o API externa).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    organization_id,
    channel = "web",
    requester_name,
    requester_email,
    subject,
    description,
    priority = "normal",
  } = body as {
    organization_id?: string;
    channel?: TicketChannel;
    requester_name?: string;
    requester_email?: string;
    subject?: string;
    description?: string;
    priority?: TicketPriority;
  };

  if (
    !organization_id ||
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

  const org = getOrganizationById(organization_id);
  if (!org) {
    return NextResponse.json(
      { error: "Organización inválida." },
      { status: 404 }
    );
  }

  const ticket = createTicket({
    organization_id,
    channel,
    requester_name: requester_name.trim(),
    requester_email: requester_email.trim(),
    subject: subject.trim(),
    description: description.trim(),
    priority,
  });

  return NextResponse.json(
    {
      ticket,
      _debug: {
        endpoint: "POST /api/tickets",
        sql: `INSERT INTO tickets (id, organization_id, ticket_number, channel, subject, status, priority) VALUES ('${ticket.id}', '${organization_id}', '${ticket.ticket_number}', '${channel}', '...', 'new', '${priority}');`,
      },
    },
    { status: 201 }
  );
}
