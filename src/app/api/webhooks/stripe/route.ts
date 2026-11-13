import { NextRequest, NextResponse } from "next/server";
import { applyStripeBillingWebhook } from "@/lib/db";
import {
  verifyStripeSignatureHeader,
  type BillingPackageId,
} from "@/lib/stripe-billing";

/**
 * POST /api/webhooks/stripe
 *
 * RECEPTOR DE WEBHOOKS DE STRIPE BILLING (Modo Test)
 * 1. Verifica la firma criptográfica `Stripe-Signature` (HMAC-SHA256) sobre el cuerpo crudo.
 * 2. Garantiza idempotencia por `stripe_event_id` (nunca duplica cargos ni cuotas).
 * 3. Actualiza el plan (`starter` -> `enterprise`) o suma +100 `Automated Resolutions` en SQL.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  if (!verifyStripeSignatureHeader(rawBody, sigHeader)) {
    return NextResponse.json(
      {
        error:
          "HTTP 401: Firma Stripe-Signature inválida. El servidor rechazó el webhook para evitar ampliaciones fraudulentas.",
      },
      { status: 401 }
    );
  }

  const event = JSON.parse(rawBody) as {
    id: string;
    type: string;
    data: {
      object: {
        organization_id: string;
        package_id: BillingPackageId;
        amount_eur: number;
        description: string;
      };
    };
  };

  const obj = event.data.object;
  const applied = applyStripeBillingWebhook({
    orgId: obj.organization_id,
    stripeEventId: event.id,
    packageId: obj.package_id,
    amountEur: obj.amount_eur,
    description: obj.description,
  });

  return NextResponse.json({
    received: true,
    idempotentDuplicate: applied.idempotentDuplicate,
    organization: applied.organization,
    billingEvent: applied.billingEvent,
    _debug: {
      endpoint: `POST /api/webhooks/stripe (${event.type})`,
      sql: applied.idempotentDuplicate
        ? `SELECT * FROM billing_events WHERE stripe_event_id='${event.id}'; -- Duplicado ignorado`
        : `UPDATE organizations SET plan='${applied.organization.plan}', ai_resolutions_limit=${applied.organization.ai_resolutions_limit}, mrr_eur=${applied.organization.mrr_eur} WHERE id='${obj.organization_id}'; INSERT INTO billing_events ...`,
    },
  });
}
