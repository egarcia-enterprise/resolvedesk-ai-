import crypto from "node:crypto";

/**
 * ADAPTADOR STRIPE BILLING & VERIFICACIÓN DE FIRMA DE WEBHOOKS
 *
 * En arquitectura SaaS nunca activamos un plan de pago solo porque el navegador
 * vuelva a "/success". La activación real ocurre cuando el servidor de Stripe envía
 * un evento asíncrono (`checkout.session.completed`) firmado con HMAC-SHA256 en la
 * cabecera `Stripe-Signature: t=timestamp,v1=hash`.
 *
 * Aquí replicamos exactamente ese protocolo criptográfico de Stripe para nuestro
 * entorno local (y soportamos `STRIPE_SECRET_KEY` si se conecta una cuenta Stripe Test).
 */

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_resolvedesk_local_test_2026";

export type BillingPackageId = "upgrade_enterprise" | "addon_100_ai";

export interface BillingPackageSpec {
  id: BillingPackageId;
  title: string;
  subtitle: string;
  amountEur: number;
  recurring: boolean;
}

export const BILLING_PACKAGES: Record<BillingPackageId, BillingPackageSpec> = {
  upgrade_enterprise: {
    id: "upgrade_enterprise",
    title: "Upgrade a Suite Enterprise + AI Copilot",
    subtitle: "50 licencias de Agente + 500 Automated Resolutions/mes + Guardrails GDPR",
    amountEur: 2450,
    recurring: true,
  },
  addon_100_ai: {
    id: "addon_100_ai",
    title: "Pack Expansión +100 Automated Resolutions",
    subtitle: "Ampliación por consumo (Usage-Based Pricing · €1,50/resolución)",
    amountEur: 150,
    recurring: false,
  },
};

export function createStripeSignatureHeader(rawPayload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedContent = `${timestamp}.${rawPayload}`;
  const v1 = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedContent)
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export function verifyStripeSignatureHeader(
  rawPayload: string,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    })
  );

  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawPayload}`)
    .digest("hex");

  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
