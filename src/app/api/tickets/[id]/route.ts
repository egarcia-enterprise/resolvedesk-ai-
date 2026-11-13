import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { deleteTicketByOrg, updateTicket } from "@/lib/db";
import type { TicketPriority, TicketStatus } from "@/lib/types";

/**
 * PATCH /api/tickets/[id]
 * Actualiza un ticket perteneciente exclusivamente al Tenant del token de sesión.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "No autenticado (HTTP 401)." },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const body = await request.json();
  const { status, priority, agent_reply } = body as {
    status?: TicketStatus;
    priority?: TicketPriority;
    agent_reply?: string;
  };

  const updated = updateTicket(session.organizationId, id, {
    status,
    priority,
    agent_reply,
  });

  if (!updated) {
    return NextResponse.json(
      { error: "Ticket no encontrado o fuera del alcance de tu Tenant." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ticket: updated,
    _debug: {
      endpoint: `PATCH /api/tickets/${id}`,
      sql: `UPDATE tickets SET status = '${updated.status}', priority = '${updated.priority}' WHERE id = '${id}' AND organization_id = '${session.organizationId}';`,
    },
  });
}

/**
 * DELETE /api/tickets/[id]
 * Borrado permanente protegido por RBAC: solo permitido para usuarios con rol 'admin'.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "No autenticado (HTTP 401)." },
      { status: 401 }
    );
  }

  if (session.role !== "admin") {
    return NextResponse.json(
      {
        error: `Acción bloqueada por RBAC (HTTP 403 Forbidden): el rol '${session.role.toUpperCase()}' (${session.userName}) no tiene permiso para eliminar tickets de auditoría. Se requiere rol 'ADMIN'.`,
        code: "RBAC_FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const deleted = deleteTicketByOrg(session.organizationId, id);

  if (!deleted) {
    return NextResponse.json(
      { error: "Ticket no encontrado en este Tenant." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    deletedId: id,
    _debug: {
      endpoint: `DELETE /api/tickets/${id} (RBAC Admin)`,
      sql: `DELETE FROM tickets WHERE id = '${id}' AND organization_id = '${session.organizationId}';`,
    },
  });
}
