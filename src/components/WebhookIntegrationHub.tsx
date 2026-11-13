"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { AuthSession, Organization, WebhookLog } from "@/lib/types";

interface WebhookIntegrationHubProps {
  session: AuthSession;
  organization: Organization;
  geminiApiKey: string;
  onRecordDebug: (endpoint: string, sql: string) => void;
  onWebhookCreatedTicket: () => void;
}

export default function WebhookIntegrationHub({
  session,
  organization,
  geminiApiKey,
  onRecordDebug,
  onWebhookCreatedTicket,
}: WebhookIntegrationHubProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [rbacMessage, setRbacMessage] = useState<string | null>(null);
  const [simResponse, setSimResponse] = useState<{
    status: number;
    body: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [lastEventId, setLastEventId] = useState<string>(
    `evt_sap_${Math.floor(10000 + Math.random() * 90000)}`
  );

  const loadAdminData = useCallback(async () => {
    const res = await fetch("/api/admin/api-keys");
    const data = await res.json();
    if (res.ok) {
      setApiKey(data.apiKey ?? null);
      setLogs(data.logs ?? []);
      if (data._debug) {
        onRecordDebug(data._debug.endpoint, data._debug.sql);
      }
    }
  }, [onRecordDebug]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, session.userId]);

  async function handleRotateKey() {
    setIsBusy(true);
    setRbacMessage(null);
    try {
      const res = await fetch("/api/admin/api-keys", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRbacMessage(data.error || "Permiso denegado (HTTP 403).");
        onRecordDebug(
          "POST /api/admin/api-keys -> 403 FORBIDDEN",
          `-- Bloqueado por RBAC en servidor: rol '${session.role}' intentó rotar clave secreta`
        );
        return;
      }
      setApiKey(data.apiKey);
      if (data._debug) {
        onRecordDebug(data._debug.endpoint, data._debug.sql);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function fireWebhookScenario(
    mode: "sap_erp" | "payment_gateway" | "duplicate_retry" | "invalid_key"
  ) {
    setIsBusy(true);
    setRbacMessage(null);
    try {
      const activeKey =
        mode === "invalid_key"
          ? "zd_fake_unauthorized_key_999"
          : apiKey ||
            (organization.id === "org_retail"
              ? "zd_live_moda_9f8a7b6c5d4e"
              : "zd_live_payflow_1a2b3c4d5e6f");

      const eventId =
        mode === "duplicate_retry"
          ? lastEventId
          : `evt_${mode}_${Math.floor(10000 + Math.random() * 90000)}`;

      if (mode !== "duplicate_retry" && mode !== "invalid_key") {
        setLastEventId(eventId);
      }

      const payload =
        mode === "payment_gateway"
          ? {
              source_system: "Stripe / Pasarela TPV",
              external_event_id: eventId,
              customer_name: "Grupo Hostelero Sur SL",
              customer_email: "tesoreria@hostelerosur.es",
              subject: "Fallo crítico de liquidación SEPA en cuenta corporativa",
              message:
                "Alerta automática de pasarela: liquidación retenida por validación bancaria para NIF B91827364 e IBAN ES66 2100 0418 4012 3456 7891. Contacto financiero: 622334455.",
              priority: "urgent",
              gemini_api_key: geminiApiKey || undefined,
            }
          : {
              source_system: "SAP S/4HANA E-Commerce",
              external_event_id: eventId,
              customer_name: "Beatriz Valdés (Cliente VIP)",
              customer_email: "beatriz.valdes@gmail.com",
              subject: `Incidencia automática pedido Express (${eventId})`,
              message:
                "Evento automático SAP: rotura de stock detectada tras cobro en tarjeta terminada en 8821 del cliente con DNI 50192837W y móvil 655443322. Requiere contacto prioritario y compensación.",
              priority: "high",
              gemini_api_key: geminiApiKey || undefined,
            };

      const res = await fetch("/api/webhooks/inbound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setSimResponse({
        status: res.status,
        body: JSON.stringify(data, null, 2),
      });

      if (data._debug) {
        onRecordDebug(data._debug.endpoint, data._debug.sql);
      } else if (res.status === 401) {
        onRecordDebug(
          "POST /api/webhooks/inbound -> 401 UNAUTHORIZED",
          "-- Rechazado: API Key inexistente o revocada en tabla organizations"
        );
      }

      await loadAdminData();
      if (res.status === 201) {
        onWebhookCreatedTicket();
      }
    } finally {
      setIsBusy(false);
    }
  }

  const displayKeyForCurl = apiKey ?? "<SOLO_VISIBLE_PARA_ROL_ADMIN>";

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Cabecera explicativa */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold text-slate-900">
                Zendesk Sunshine · Integraciones API, Webhooks & Seguridad RBAC
              </h2>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                  session.role === "admin"
                    ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                    : "bg-sky-100 text-sky-900 border-sky-300"
                }`}
              >
                Tu rol actual: {session.role}
              </span>
            </div>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              Así conectan clientes como Inditex o El Corte Inglés su{" "}
              <strong>SAP, Shopify o pasarela de pagos</strong> con un SaaS: mediante{" "}
              <strong>API Keys por Tenant</strong>, cabeceras{" "}
              <code className="font-mono bg-slate-100 px-1 rounded">
                Authorization: Bearer
              </code>{" "}
              y claves de <strong>Idempotencia</strong> para no duplicar tickets si falla la red.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* COLUMNA IZQUIERDA: API KEY + RBAC */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                1. Credencial Secreta del Tenant ({organization.name})
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                RBAC Policy: ADMIN ONLY
              </span>
            </div>

            {session.role === "admin" ? (
              <div className="rounded-xl bg-slate-900 text-emerald-300 p-4 font-mono text-xs flex items-center justify-between gap-3">
                <span className="truncate">{apiKey}</span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleRotateKey}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-sans font-bold text-xs cursor-pointer transition"
                >
                  🔄 Rotar API Key
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-100 border border-slate-200 p-4 text-xs text-slate-600 flex items-center justify-between gap-3">
                  <span className="font-mono text-slate-400">
                    zd_live_•••••••••••••••••••• (Oculta por RBAC)
                  </span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleRotateKey}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs cursor-pointer transition"
                  >
                    🔒 Intentar rotar como Agente (Probar 403)
                  </button>
                </div>
              </div>
            )}

            {rbacMessage && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-900">
                <div className="font-bold mb-0.5">
                  Respuesta del Servidor: HTTP 403 Forbidden
                </div>
                <div>{rbacMessage}</div>
              </div>
            )}

            {/* Ejemplo real de comando cURL */}
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1.5">
                Ejemplo real de llamada desde servidor externo (cURL):
              </div>
              <pre className="rounded-xl bg-slate-900 text-slate-200 p-3.5 text-[11px] font-mono overflow-x-auto leading-relaxed">
{`curl -X POST http://localhost:3000/api/webhooks/inbound \\
  -H "Authorization: Bearer ${displayKeyForCurl}" \\
  -H "Content-Type: application/json" \\
  -d '{"source_system":"SAP ERP","external_event_id":"${lastEventId}","customer_name":"Cliente VIP","customer_email":"vip@cliente.es","subject":"Retraso envío","message":"DNI 48291044L..."}'`}
              </pre>
            </div>
          </div>

          {/* COLUMNA DERECHA: SIMULADOR INTERACTIVO DE WEBHOOKS */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              2. Simulador de Eventos Externos en Tiempo Real
            </h3>
            <p className="text-xs text-slate-500">
              Dispara llamadas HTTP reales contra{" "}
              <code className="font-mono bg-slate-100 px-1 rounded">
                POST /api/webhooks/inbound
              </code>{" "}
              y comprueba cómo el ticket entra ya anonimizado y clasificado en tu cola:
            </p>

            <div className="grid sm:grid-cols-2 gap-2.5 text-xs">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fireWebhookScenario("sap_erp")}
                className="p-3 rounded-xl border border-teal-200 bg-teal-50/60 hover:bg-teal-100/70 text-left transition cursor-pointer"
              >
                <div className="font-bold text-[#03363D] mb-0.5">
                  📦 Disparar Evento SAP ERP
                </div>
                <div className="text-slate-600 text-[11px]">
                  Inyecta rotura de stock con DNI/Tarjeta → Crea ticket + Triaje IA
                </div>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => fireWebhookScenario("payment_gateway")}
                className="p-3 rounded-xl border border-teal-200 bg-teal-50/60 hover:bg-teal-100/70 text-left transition cursor-pointer"
              >
                <div className="font-bold text-[#03363D] mb-0.5">
                  💳 Disparar Alerta TPV / SEPA
                </div>
                <div className="text-slate-600 text-[11px]">
                  Inyecta fallo bancario con NIF e IBAN → Crea ticket Urgente
                </div>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => fireWebhookScenario("duplicate_retry")}
                className="p-3 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 text-left transition cursor-pointer"
              >
                <div className="font-bold text-amber-950 mb-0.5">
                  🔁 Reintentar mismo Event ID
                </div>
                <div className="text-amber-900/80 text-[11px]">
                  Prueba de Idempotencia ({lastEventId}) → Evita ticket duplicado
                </div>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => fireWebhookScenario("invalid_key")}
                className="p-3 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100/70 text-left transition cursor-pointer"
              >
                <div className="font-bold text-rose-950 mb-0.5">
                  🚫 Enviar API Key Falsa
                </div>
                <div className="text-rose-900/80 text-[11px]">
                  Simula ataque externo → El servidor responde HTTP 401
                </div>
              </button>
            </div>

            {simResponse && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700">
                    Respuesta JSON devuelta por tu Backend:
                  </span>
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                      simResponse.status === 201
                        ? "bg-emerald-100 text-emerald-900"
                        : simResponse.status === 200
                        ? "bg-amber-100 text-amber-900"
                        : "bg-red-100 text-red-900"
                    }`}
                  >
                    HTTP {simResponse.status}
                  </span>
                </div>
                <pre className="rounded-xl bg-slate-900 text-emerald-200 p-3 text-[11px] font-mono max-h-44 overflow-auto">
                  {simResponse.body}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* TABLA DE AUDITORÍA DE WEBHOOKS */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            3. Registro de Auditoría de Webhooks (`webhook_logs` aislados para {organization.name})
          </h3>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-400">
              Aún no se han recibido webhooks externos en este Tenant. Pulsa cualquiera de los botones del simulador arriba.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px]">
                    <th className="py-2 pr-4">Hora</th>
                    <th className="py-2 pr-4">Sistema Origen</th>
                    <th className="py-2 pr-4">External Event ID</th>
                    <th className="py-2 pr-4">HTTP</th>
                    <th className="py-2 pr-4">Resultado</th>
                    <th className="py-2">Ticket Asociado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 pr-4 font-mono text-slate-500">
                        {new Date(log.created_at).toLocaleTimeString("es-ES")}
                      </td>
                      <td className="py-2.5 pr-4 font-semibold text-slate-800">
                        {log.source_system}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-slate-600">
                        {log.external_event_id ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded ${
                            log.status_code === 201
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {log.status_code}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-700">
                        {log.outcome}
                      </td>
                      <td className="py-2.5 font-mono font-bold text-[#03363D]">
                        {log.ticket_number ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
