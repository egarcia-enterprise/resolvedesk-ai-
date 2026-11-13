"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession, BillingEvent, Organization } from "@/lib/types";
import type { BillingPackageId, BillingPackageSpec } from "@/lib/stripe-billing";

interface ExecutiveMetrics {
  totalTickets: number;
  aiTriagedTickets: number;
  solvedTickets: number;
  urgentTickets: number;
  totalPiiBlocked: number;
  webhookTickets: number;
}

interface PreparedCheckout {
  package: BillingPackageSpec;
  stripeEventId: string;
  webhookPayload: Record<string, unknown>;
  stripeSignature: string;
}

interface BillingAndRoiDashboardProps {
  session: AuthSession;
  organization: Organization;
  onOrganizationUpdated: (org: Organization) => void;
  onRecordDebug: (endpoint: string, sql: string) => void;
}

export default function BillingAndRoiDashboard({
  session,
  organization,
  onOrganizationUpdated,
  onRecordDebug,
}: BillingAndRoiDashboardProps) {
  const [metrics, setMetrics] = useState<ExecutiveMetrics>({
    totalTickets: 0,
    aiTriagedTickets: 0,
    solvedTickets: 0,
    urgentTickets: 0,
    totalPiiBlocked: 0,
    webhookTickets: 0,
  });
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([]);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [checkoutModal, setCheckoutModal] = useState<PreparedCheckout | null>(
    null
  );

  // Sliders interactivos para Business Case MEDDPICC (CFO / VP CX)
  const [monthlyVolume, setMonthlyVolume] = useState<number>(
    organization.plan === "enterprise" ? 18000 : 2500
  );
  const [automationRatePct, setAutomationRatePct] = useState<number>(42);
  const [humanTicketCostEur, setHumanTicketCostEur] = useState<number>(9.5);

  const loadBilling = useCallback(async () => {
    const res = await fetch("/api/billing");
    const data = await res.json();
    if (res.ok) {
      if (data.organization) onOrganizationUpdated(data.organization);
      if (data.metrics) setMetrics(data.metrics);
      if (data.billingEvents) setBillingEvents(data.billingEvents);
      if (data._debug) onRecordDebug(data._debug.endpoint, data._debug.sql);
    }
  }, [onOrganizationUpdated, onRecordDebug]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling, session.userId]);

  async function handleStartCheckout(packageId: BillingPackageId) {
    setIsBusy(true);
    setRbacError(null);
    setSuccessBanner(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare_checkout",
          packageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRbacError(data.error || "Permiso denegado (HTTP 403).");
        onRecordDebug(
          "POST /api/billing -> 403 FORBIDDEN",
          `-- RBAC bloqueó intento de compra por rol '${session.role}'`
        );
        return;
      }
      if (data.checkoutSession) {
        setCheckoutModal(data.checkoutSession);
        if (data._debug) onRecordDebug(data._debug.endpoint, data._debug.sql);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmStripePayment() {
    if (!checkoutModal) return;
    setIsBusy(true);
    try {
      const rawPayload = JSON.stringify(checkoutModal.webhookPayload);
      const res = await fetch("/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": checkoutModal.stripeSignature,
        },
        body: rawPayload,
      });
      const data = await res.json();
      if (res.ok && data.organization) {
        onOrganizationUpdated(data.organization);
        setSuccessBanner(
          `Pago procesado en Stripe Test Mode (${checkoutModal.stripeEventId}). Webhook verificado por HMAC y cuota actualizada a ${data.organization.ai_resolutions_used}/${data.organization.ai_resolutions_limit} resoluciones.`
        );
        setCheckoutModal(null);
        if (data._debug) onRecordDebug(data._debug.endpoint, data._debug.sql);
        await loadBilling();
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleResetDemoStarter() {
    setIsBusy(true);
    setRbacError(null);
    setSuccessBanner(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_demo_starter" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRbacError(data.error || "Permiso denegado (HTTP 403).");
        return;
      }
      if (data.organization) {
        onOrganizationUpdated(data.organization);
        setSuccessBanner(
          "Tenant restaurado a Plan Starter (8/10 resoluciones, €190 MRR) para volver a ensayar el flujo de agotamiento de cuota y upgrade."
        );
        if (data._debug) onRecordDebug(data._debug.endpoint, data._debug.sql);
      }
    } finally {
      setIsBusy(false);
    }
  }

  // Cálculos financieros MEDDPICC en tiempo real
  const roiCalc = useMemo(() => {
    const automatedPerMonth = Math.round(
      monthlyVolume * (automationRatePct / 100)
    );
    const manualBaselineMonthlyEur = monthlyVolume * humanTicketCostEur;
    const aiResolutionCostEur = 1.5;
    const grossMonthlySavingsEur =
      automatedPerMonth * (humanTicketCostEur - aiResolutionCostEur);
    const netAnnualSavingsEur = Math.max(
      0,
      Math.round((grossMonthlySavingsEur - organization.mrr_eur) * 12)
    );
    const hoursSavedPerYear = Math.round((automatedPerMonth * 12 * 6.1) / 60);
    const annualContractValue = Math.max(1, organization.mrr_eur * 12);
    const roiMultiple = (
      (grossMonthlySavingsEur * 12) /
      annualContractValue
    ).toFixed(1);

    return {
      automatedPerMonth,
      manualBaselineMonthlyEur: Math.round(manualBaselineMonthlyEur),
      netAnnualSavingsEur,
      hoursSavedPerYear,
      roiMultiple,
    };
  }, [
    monthlyVolume,
    automationRatePct,
    humanTicketCostEur,
    organization.mrr_eur,
  ]);

  const triageCoveragePct =
    metrics.totalTickets > 0
      ? Math.round((metrics.aiTriagedTickets / metrics.totalTickets) * 100)
      : 0;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Banners de estado */}
        {rbacError && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-900">
            <div className="font-bold mb-0.5">
              Política RBAC Financiera (HTTP 403 Forbidden)
            </div>
            <div>{rbacError}</div>
          </div>
        )}

        {successBanner && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-300 p-4 text-xs text-emerald-950 flex items-center justify-between gap-4">
            <div>
              <strong className="block mb-0.5 text-emerald-900">
                ✓ Suscripción y Cuota Actualizadas en SQL
              </strong>
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-800 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* FILA 1: KPIs REALES DESDE SQLITE */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Contrato Activo (ARR / MRR)
            </span>
            <div className="text-2xl font-black text-slate-900 mt-1">
              €{(organization.mrr_eur * 12).toLocaleString("es-ES")}
              <span className="text-xs font-medium text-slate-500 ml-1">
                ARR
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Plan{" "}
              <strong className="uppercase text-[#03363D]">
                {organization.plan}
              </strong>{" "}
              • €{organization.mrr_eur}/mes • {organization.seats_limit} seats
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Cuota Automated Resolutions
            </span>
            <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
              {organization.ai_resolutions_used}
              <span className="text-slate-400 text-lg">
                /{organization.ai_resolutions_limit}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Modelo híbrido: Asientos fijos + Consumo IA
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Cobertura Intelligent Triage
            </span>
            <div className="text-2xl font-black text-emerald-700 mt-1">
              {triageCoveragePct}%
              <span className="text-xs font-medium text-slate-500 ml-1.5">
                ({metrics.aiTriagedTickets}/{metrics.totalTickets} tickets)
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              First Reply Time (FRT): <strong>&lt; 15 seg</strong> vs 4,2h manual
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Escudo GDPR / PII Auditado
            </span>
            <div className="text-2xl font-black text-amber-700 mt-1">
              {metrics.totalPiiBlocked}
              <span className="text-xs font-medium text-slate-500 ml-1.5">
                datos bloqueados
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              0 fugas de DNI, IBAN o tarjetas hacia el LLM
            </div>
          </div>
        </div>

        {/* FILA 2: PLANES SAAS & STRIPE BILLING */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Monetización SaaS Híbrida & Pasarela Stripe Billing (Modo Test)
                </h2>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Stripe Webhooks HMAC
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Replica el pricing real de <strong>Zendesk Suite + AI Copilot</strong>: licencias recurrentes por agente (MRR base) + paquetes de <em>Automated Resolutions</em> (expansión NRR).
              </p>
            </div>

            {organization.id === "org_fintech" && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleResetDemoStarter}
                className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-600 cursor-pointer transition"
              >
                ↺ Restaurar PayFlow a Starter (8/10)
              </button>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Opción 1: Upgrade a Enterprise */}
            <div className="rounded-2xl border-2 border-[#03363D] bg-teal-50/30 p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#03363D]">
                    Suscripción Base + IA
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    Recomendado Enterprise
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Suite Enterprise + AI Copilot
                </h3>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  €2.450
                  <span className="text-xs font-normal text-slate-500">
                    /mes facturación recurrente
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                  <li>Hasta 50 licencias de Agente con control RBAC</li>
                  <li>
                    <strong>+500 Automated Resolutions</strong> añadidas al límite mensual
                  </li>
                  <li>Advanced Data Privacy (Anonimización GDPR automática)</li>
                </ul>
              </div>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleStartCheckout("upgrade_enterprise")}
                className="w-full py-2.5 px-4 rounded-xl bg-[#635BFF] hover:bg-[#5249f5] text-white font-semibold text-xs shadow-xs transition cursor-pointer"
              >
                💳 Contratar / Ampliar con Stripe Checkout →
              </button>
            </div>

            {/* Opción 2: Add-on Usage-based (+100 Automated Resolutions) */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Expansión por Consumo (NRR)
                  </span>
                  <span className="text-xs font-mono font-semibold text-indigo-700">
                    €1,50 / resolución
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Pack +100 Automated Resolutions
                </h3>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  €150
                  <span className="text-xs font-normal text-slate-500">
                    {" "}
                    ampliación inmediata sin cambiar de tier
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                  <li>Desbloquea al instante tickets detenidos por error HTTP 402</li>
                  <li>Coste 84% inferior a los €9,50 de un ticket resuelto manualmente</li>
                  <li>Ideal para picos estacionales (Black Friday / Rebajas)</li>
                </ul>
              </div>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleStartCheckout("addon_100_ai")}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
              >
                ⚡ Añadir +100 Resoluciones vía Stripe →
              </button>
            </div>
          </div>
        </div>

        {/* FILA 3: CALCULADORA EJECUTIVA MEDDPICC (CFO / VP CX) + HISTORIAL STRIPE */}
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Calculadora de Business Case Ejecutivo (MEDDPICC · CFO & VP CX)
              </h3>
              <p className="text-xs text-slate-500">
                Modela en directo en una llamada comercial el ahorro anual frente a operación manual tradicional:
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between font-semibold text-slate-700 mb-1">
                  <span>Volumen mensual de tickets del cliente:</span>
                  <span className="font-mono text-[#03363D]">
                    {monthlyVolume.toLocaleString("es-ES")} tickets/mes
                  </span>
                </div>
                <input
                  type="range"
                  min={500}
                  max={50000}
                  step={500}
                  value={monthlyVolume}
                  onChange={(e) => setMonthlyVolume(Number(e.target.value))}
                  className="w-full accent-[#03363D]"
                />
              </div>

              <div>
                <div className="flex justify-between font-semibold text-slate-700 mb-1">
                  <span>Tasa de Resolución / Deflexión con IA:</span>
                  <span className="font-mono text-[#03363D]">
                    {automationRatePct}% ({roiCalc.automatedPerMonth.toLocaleString("es-ES")}{" "}
                    tickets/mes)
                  </span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={65}
                  step={1}
                  value={automationRatePct}
                  onChange={(e) => setAutomationRatePct(Number(e.target.value))}
                  className="w-full accent-[#03363D]"
                />
              </div>

              <div>
                <div className="flex justify-between font-semibold text-slate-700 mb-1">
                  <span>Coste operativo medio por ticket manual (Europa):</span>
                  <span className="font-mono text-[#03363D]">
                    €{humanTicketCostEur.toFixed(2)} / ticket
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={18}
                  step={0.5}
                  value={humanTicketCostEur}
                  onChange={(e) => setHumanTicketCostEur(Number(e.target.value))}
                  className="w-full accent-[#03363D]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
                <div className="text-[10px] font-bold uppercase text-emerald-800">
                  Ahorro Neto Anual
                </div>
                <div className="text-lg font-black text-emerald-950 mt-0.5">
                  €{roiCalc.netAnnualSavingsEur.toLocaleString("es-ES")}
                </div>
                <div className="text-[11px] text-emerald-800/80">
                  Descontando licencia SaaS
                </div>
              </div>

              <div className="rounded-xl bg-teal-50 border border-teal-200 p-3.5">
                <div className="text-[10px] font-bold uppercase text-[#03363D]">
                  Tiempo Agente Liberado
                </div>
                <div className="text-lg font-black text-slate-900 mt-0.5">
                  {roiCalc.hoursSavedPerYear.toLocaleString("es-ES")} h/año
                </div>
                <div className="text-[11px] text-slate-600">
                  -71% reducción en AHT
                </div>
              </div>

              <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3.5">
                <div className="text-[10px] font-bold uppercase text-indigo-800">
                  Retorno Financiero
                </div>
                <div className="text-lg font-black text-indigo-950 mt-0.5">
                  {roiCalc.roiMultiple}x ROI
                </div>
                <div className="text-[11px] text-indigo-800/80">
                  Payback &lt; 2 meses
                </div>
              </div>
            </div>
          </div>

          {/* Historial de Webhooks Stripe */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">
                Registro SQL de Pagos Stripe (`billing_events`)
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Eventos verificados criptográficamente con idempotencia por{" "}
                <code className="font-mono">stripe_event_id</code>:
              </p>

              {billingEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  Aún no hay transacciones Stripe registradas para{" "}
                  {organization.name}. Prueba a contratar una ampliación arriba.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {billingEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>{ev.description}</span>
                        <span className="text-emerald-700 font-mono">
                          +€{ev.amount_eur}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono mt-1">
                        <span>{ev.stripe_event_id}</span>
                        <span>{ev.event_type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MODAL INTERACTIVO DE STRIPE CHECKOUT (MODO TEST)
      ===================================================================== */}
      {checkoutModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-[#635BFF] text-white px-6 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base">Stripe Checkout</span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-300 text-slate-900">
                    Test Mode
                  </span>
                </div>
                <p className="text-xs text-indigo-100">
                  Facturando a {organization.name} ({session.userEmail})
                </p>
              </div>
              <button
                onClick={() => setCheckoutModal(null)}
                className="text-indigo-100 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                <div className="font-bold text-sm text-slate-900">
                  {checkoutModal.package.title}
                </div>
                <div className="text-slate-500 mt-0.5">
                  {checkoutModal.package.subtitle}
                </div>
                <div className="text-xl font-black text-slate-900 mt-2">
                  €{checkoutModal.package.amountEur.toLocaleString("es-ES")}
                  {checkoutModal.package.recurring ? " / mes" : " pago único"}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-semibold text-slate-700">
                  Tarjeta Oficial de Prueba Stripe
                </label>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <input
                    readOnly
                    value="4242 •••• •••• 4242"
                    className="col-span-2 border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-slate-800"
                  />
                  <input
                    readOnly
                    value="12/29 · 424"
                    className="border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-slate-800"
                  />
                </div>
              </div>

              <div className="rounded-lg bg-slate-900 text-slate-300 p-3 font-mono text-[10px] space-y-1">
                <div className="text-indigo-300 font-bold">
                  Webhook que se disparará a POST /api/webhooks/stripe:
                </div>
                <div className="truncate">
                  Event ID: {checkoutModal.stripeEventId}
                </div>
                <div className="truncate text-emerald-300">
                  Stripe-Signature: {checkoutModal.stripeSignature}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCheckoutModal(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleConfirmStripePayment}
                  className="px-5 py-2.5 rounded-xl bg-[#635BFF] hover:bg-[#5249f5] text-white font-bold cursor-pointer transition"
                >
                  {isBusy
                    ? "Verificando Webhook..."
                    : `Pagar €${checkoutModal.package.amountEur} y Activar`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
