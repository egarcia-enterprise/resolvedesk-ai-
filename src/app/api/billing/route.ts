import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  getExecutiveOrgMetrics,
  getOrganizationById,
  listBillingEventsByOrg,
  resetStarterPlanForDemo,
} from "@/lib/db";
import {
  BILLING_PACKAGES,
  createStripeSignatureHeader,
  type BillingPackageId,
} from "@/lib/stripe-billing";

/**
 * GET /api/billing
 * Devuelve métricas operativas/ROI reales calculadas desde SQL y el historial de facturación Stripe.
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "No autenticado (HTTP 401)." },
      { status: 401 }
    );
  }

  const organization = getOrganizationById(session.organizationId, false);
  const metrics = getExecutiveOrgMetrics(session.organizationId);
  const billingEvents = listBillingEventsByOrg(session.organizationId);

  return NextResponse.json({
    organization,
    metrics,
    billingEvents,
    packages: Object.values(BILLING_PACKAGES),
    _debug: {
      endpoint: "GET /api/billing",
      sql: `SELECT * FROM organizations WHERE id='${session.organizationId}'; SELECT * FROM billing_events WHERE organization_id='${session.organizationId}';`,
    },
  });
}

/**
 * POST /api/billing
 * Inicia una sesión de Stripe Checkout o resetea el plan Starter de demostración.
 * Protegido estrictamente por RBAC (solo 'admin' puede alterar contratos o facturación).
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
        error: `Operación bloqueada por RBAC (HTTP 403 Forbidden): tu usuario (${session.userName}) tiene rol '${session.role.toUpperCase()}'. Solo Finanzas / Administradores ('ADMIN') pueden contratar ampliaciones de licencia o cuota en Stripe.`,
        code: "RBAC_FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { action, packageId } = body as {
    action?: "prepare_checkout" | "reset_demo_starter";
    packageId?: BillingPackageId;
  };

  if (action === "reset_demo_starter") {
    const updatedOrg = resetStarterPlanForDemo(session.organizationId);
    return NextResponse.json({
      organization: updatedOrg,
      _debug: {
        endpoint: "POST /api/billing (Demo Reset)",
        sql: `UPDATE organizations SET plan='starter', ai_resolutions_used=8, ai_resolutions_limit=10, mrr_eur=190 WHERE id='${session.organizationId}';`,
      },
    });
  }

  const pkg = packageId ? BILLING_PACKAGES[packageId] : undefined;
  if (!pkg) {
    return NextResponse.json(
      { error: "Paquete de suscripción inválido." },
      { status: 400 }
    );
  }

  // Preparamos el evento firmado criptográficamente tal como lo emite Stripe CLI en local
  const stripeEventId = `evt_stripe_${crypto.randomBytes(6).toString("hex")}`;
  const webhookPayloadObj = {
    id: stripeEventId,
    type:
      pkg.id === "upgrade_enterprise"
        ? "customer.subscription.updated"
        : "checkout.session.completed",
    data: {
      object: {
        organization_id: session.organizationId,
        package_id: pkg.id,
        amount_eur: pkg.amountEur,
        description: pkg.title,
        customer_email: session.userEmail,
      },
    },
  };

  const rawPayload = JSON.stringify(webhookPayloadObj);
  const stripeSignature = createStripeSignatureHeader(rawPayload);

  return NextResponse.json({
    checkoutSession: {
      package: pkg,
      stripeEventId,
      webhookPayload: webhookPayloadObj,
      stripeSignature,
    },
    _debug: {
      endpoint: "POST /api/billing (Create Stripe Checkout Session)",
      sql: `-- Sesión Stripe Test preparada (${stripeEventId}) para ${pkg.id} (€${pkg.amountEur})`,
    },
  });
}
