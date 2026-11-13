import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  processTicketWithAiGuardrails,
  TriageServiceError,
} from "@/lib/triage-service";

/**
 * POST /api/tickets/[id]/triage
 * Dispara el pipeline GDPR Guardrail + Intelligent Triage & Agent Copilot
 * validando el Tenant mediante la cookie criptográfica de sesión.
 */
export async function POST(
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
  const body = await request.json().catch(() => ({}));
  const { gemini_api_key } = body as { gemini_api_key?: string };

  try {
    const result = await processTicketWithAiGuardrails(
      session.organizationId,
      id,
      gemini_api_key
    );

    return NextResponse.json({
      ...result,
      _debug: {
        endpoint: `POST /api/tickets/${id}/triage`,
        sql: `UPDATE tickets SET redacted_description='[GDPR_MASKED]', intent='${result.ticket.intent}', priority='${result.ticket.priority}' WHERE id='${id}' AND organization_id='${session.organizationId}';${
          result.consumedCredit
            ? ` UPDATE organizations SET ai_resolutions_used = ai_resolutions_used + 1 WHERE id='${session.organizationId}';`
            : ""
        }`,
      },
    });
  } catch (err) {
    if (err instanceof TriageServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: "Error interno procesando el triaje con IA." },
      { status: 500 }
    );
  }
}
