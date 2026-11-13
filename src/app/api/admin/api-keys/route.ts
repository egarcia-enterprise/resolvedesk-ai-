import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  getOrganizationById,
  listWebhookLogsByOrg,
  rotateOrganizationApiKey,
} from "@/lib/db";

/**
 * GET /api/admin/api-keys
 * Devuelve el historial de webhooks del Tenant y, SOLO si el usuario tiene rol 'admin',
 * expone la API Key activa de integración.
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "No autenticado (HTTP 401)." },
      { status: 401 }
    );
  }

  const isAdmin = session.role === "admin";
  const org = getOrganizationById(session.organizationId, isAdmin);
  const logs = listWebhookLogsByOrg(session.organizationId);

  return NextResponse.json({
    role: session.role,
    rbacRestricted: !isAdmin,
    apiKey: isAdmin ? org?.api_key ?? null : null,
    logs,
    _debug: {
      endpoint: "GET /api/admin/api-keys",
      sql: isAdmin
        ? `SELECT api_key FROM organizations WHERE id='${session.organizationId}'; SELECT * FROM webhook_logs WHERE organization_id='${session.organizationId}';`
        : `-- RBAC: api_key oculta para rol 'agent'. SELECT * FROM webhook_logs WHERE organization_id='${session.organizationId}';`,
    },
  });
}

/**
 * POST /api/admin/api-keys
 * Rota la API Key secreta del Tenant. Protegido estrictamente por RBAC (solo 'admin').
 */
export async function POST(request: NextRequest) {
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
        error: `Acceso denegado por RBAC (HTTP 403 Forbidden): tu sesión actual (${session.userName}) tiene rol '${session.role.toUpperCase()}'. Solo los usuarios 'ADMIN' pueden rotar claves API corporativas.`,
        code: "RBAC_FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const newKey = rotateOrganizationApiKey(session.organizationId);
  return NextResponse.json({
    apiKey: newKey,
    _debug: {
      endpoint: "POST /api/admin/api-keys (Rotate Secret)",
      sql: `UPDATE organizations SET api_key = '${newKey}' WHERE id = '${session.organizationId}'; -- Autorizado para ADMIN`,
    },
  });
}
