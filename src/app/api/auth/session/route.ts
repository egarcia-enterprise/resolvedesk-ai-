import { NextRequest, NextResponse } from "next/server";
import {
  getOrganizationById,
  getUserById,
  listOrganizations,
  listUsersByOrg,
} from "@/lib/db";
import {
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from "@/lib/auth";

/**
 * GET /api/auth/session
 * Verifica la cookie HttpOnly firmada con HMAC-SHA256 y devuelve la sesión actual
 * más las cuentas corporativas disponibles para el simulador de SSO Enterprise.
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const demoOrgs = listOrganizations().map((org) => ({
    ...org,
    users: listUsersByOrg(org.id),
  }));

  if (!session) {
    return NextResponse.json({
      authenticated: false,
      session: null,
      organization: null,
      demoOrgs,
      _debug: {
        endpoint: "GET /api/auth/session",
        sql: "-- Sin cookie rd_session activa: mostrando Portal SSO Corporativo",
      },
    });
  }

  const organization = getOrganizationById(session.organizationId, false);
  return NextResponse.json({
    authenticated: true,
    session,
    organization,
    demoOrgs,
    _debug: {
      endpoint: "GET /api/auth/session",
      sql: `SELECT * FROM users WHERE id='${session.userId}'; -- Cookie HMAC verificada (tenant='${session.organizationId}', role='${session.role}')`,
    },
  });
}

/**
 * POST /api/auth/session
 * Inicia sesión SSO corporativa, firma el token HMAC-SHA256 y lo inyecta en Cookie HttpOnly.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userId } = body as { userId?: string };

  if (!userId) {
    return NextResponse.json(
      { error: "Debe seleccionar un usuario para iniciar sesión SSO." },
      { status: 400 }
    );
  }

  const user = getUserById(userId);
  if (!user) {
    return NextResponse.json(
      { error: "Credenciales SSO inválidas: usuario no existe." },
      { status: 401 }
    );
  }

  const org = getOrganizationById(user.organization_id, false);
  if (!org) {
    return NextResponse.json(
      { error: "Organización asociada no encontrada." },
      { status: 404 }
    );
  }

  const token = signSessionToken({
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    userName: user.name,
    userEmail: user.email,
  });

  const response = NextResponse.json({
    authenticated: true,
    session: {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
      userName: user.name,
      userEmail: user.email,
    },
    organization: org,
    _debug: {
      endpoint: "POST /api/auth/session (SSO Login)",
      sql: `SELECT id, organization_id, role FROM users WHERE id = '${user.id}'; -- Emitida Cookie HttpOnly firmada (HMAC-SHA256)`,
    },
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}

/**
 * DELETE /api/auth/session
 * Cierra la sesión destruyendo la cookie HttpOnly en el navegador.
 */
export async function DELETE() {
  const response = NextResponse.json({
    authenticated: false,
    _debug: {
      endpoint: "DELETE /api/auth/session (Logout)",
      sql: "-- Cookie HttpOnly rd_session revocada",
    },
  });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
