import { NextRequest, NextResponse } from "next/server";
import { updateTicket } from "@/lib/db";
import type { TicketPriority, TicketStatus } from "@/lib/types";

/**
 * PATCH /api/tickets/[id]
 * Actualiza el estado, la prioridad o guarda la respuesta del agente de soporte.
 * Incluye validación cruzada `WHERE id = ? AND organization_id = ?` para evitar fugas entre clientes.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();
  const { organization_id, status, priority, agent_reply } = body as {
    organization_id?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    agent_reply?: string;
  };

  if (!organization_id) {
    return NextResponse.json(
      { error: "Se requiere organization_id para validar permisos del Tenant." },
      { status: 400 }
    );
  }

  const updated = updateTicket(organization_id, id, {
    status,
    priority,
    agent_reply,
  });

  if (!updated) {
    return NextResponse.json(
      { error: "Ticket no encontrado o no pertenece a esta organización." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ticket: updated,
    _debug: {
      endpoint: `PATCH /api/tickets/${id}`,
      sql: `UPDATE tickets SET status = '${updated.status}', priority = '${updated.priority}' WHERE id = '${id}' AND organization_id = '${organization_id}';`,
    },
  });
}
