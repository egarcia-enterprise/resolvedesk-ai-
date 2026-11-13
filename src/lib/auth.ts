import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import type { AuthSession } from "./types";

/**
 * AUTENTICACIÓN CLOUD Y TOKENS FIRMADOS (Estilo JWT / SSO Cookie HttpOnly)
 *
 * En un SaaS real NUNCA confiamos en que el navegador nos diga "soy de la empresa X"
 * en un parámetro de la URL. Cuando el usuario inicia sesión (SSO o contraseña),
 * el servidor firma criptográficamente un token con HMAC-SHA256 y lo guarda en una
 * cookie `HttpOnly` (inaccesible para scripts maliciosos XSS).
 */

export const SESSION_COOKIE_NAME = "rd_session";

const AUTH_SECRET =
  process.env.AUTH_SECRET || "resolvedesk-enterprise-local-secret-key-2026";

export function signSessionToken(
  payload: Omit<AuthSession, "exp">
): string {
  const fullPayload: AuthSession = {
    ...payload,
    // Sesión válida durante 7 días
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };

  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString(
    "base64url"
  );
  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): AuthSession | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  // Comparación en tiempo constante para evitar ataques criptográficos (Timing Attacks)
  const a = Buffer.from(providedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    ) as AuthSession;

    if (decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest): AuthSession | null {
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(cookieToken);
}
