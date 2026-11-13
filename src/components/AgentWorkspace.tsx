"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuthSession,
  Organization,
  PiiDetection,
  Ticket,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";
import SsoLoginPortal, { type DemoOrgWithUsers } from "./SsoLoginPortal";
import WebhookIntegrationHub from "./WebhookIntegrationHub";
import BillingAndRoiDashboard from "./BillingAndRoiDashboard";

interface DebugLog {
  endpoint: string;
  sql: string;
  timestamp: string;
}

const STATUS_META: Record<
  TicketStatus,
  { label: string; badgeClass: string }
> = {
  new: {
    label: "Nuevo",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
  },
  open: {
    label: "Abierto",
    badgeClass: "bg-rose-100 text-rose-900 border-rose-300",
  },
  pending: {
    label: "Pendiente",
    badgeClass: "bg-sky-100 text-sky-900 border-sky-300",
  },
  solved: {
    label: "Resuelto",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
};

const PRIORITY_META: Record<
  TicketPriority,
  { label: string; badgeClass: string }
> = {
  urgent: {
    label: "Urgente (SLA 1h)",
    badgeClass: "bg-red-600 text-white",
  },
  high: {
    label: "Alta (SLA 4h)",
    badgeClass: "bg-orange-100 text-orange-800 border border-orange-300",
  },
  normal: {
    label: "Normal (SLA 24h)",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-300",
  },
  low: {
    label: "Baja",
    badgeClass: "bg-slate-50 text-slate-500 border border-slate-200",
  },
};

const CHANNEL_LABEL: Record<TicketChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  web: "Web Center",
  api: "Webhook API",
};

function getSentimentBadgeClass(sentiment: string | null): string {
  if (!sentiment) return "bg-slate-100 text-slate-600 border-slate-200";
  const s = sentiment.toLowerCase();
  if (s.includes("muy negativo") || s.includes("churn")) {
    return "bg-red-100 text-red-800 border-red-300";
  }
  if (s.includes("frustrado") || s.includes("negativo")) {
    return "bg-amber-100 text-amber-900 border-amber-300";
  }
  if (s.includes("positivo")) {
    return "bg-emerald-100 text-emerald-800 border-emerald-300";
  }
  return "bg-slate-100 text-slate-700 border-slate-300";
}

function parsePiiDetections(raw: string | null): PiiDetection[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PiiDetection[];
  } catch {
    return [];
  }
}

export default function AgentWorkspace() {
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [demoOrgs, setDemoOrgs] = useState<DemoOrgWithUsers[]>([]);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"tickets" | "webhooks" | "billing">(
    "tickets"
  );
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>("");
  const [showRedactedView, setShowRedactedView] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTriaging, setIsTriaging] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [showApiModal, setShowApiModal] = useState<boolean>(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");

  const [debugLog, setDebugLog] = useState<DebugLog>({
    endpoint: "GET /api/auth/session",
    sql: "-- Verificando cookie criptográfica rd_session...",
    timestamp: "--:--:--",
  });

  // Campos del formulario para simular la llegada de un nuevo ticket
  const [newChannel, setNewChannel] = useState<TicketChannel>("whatsapp");
  const [newRequesterName, setNewRequesterName] = useState<string>("");
  const [newRequesterEmail, setNewRequesterEmail] = useState<string>("");
  const [newPriority, setNewPriority] = useState<TicketPriority>("normal");
  const [newSubject, setNewSubject] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [autoTriageOnCreate, setAutoTriageOnCreate] = useState<boolean>(true);

  const recordDebug = useCallback((endpoint: string, sql: string) => {
    const now = new Date().toLocaleTimeString("es-ES", { hour12: false });
    setDebugLog({ endpoint, sql, timestamp: now });
  }, []);

  useEffect(() => {
    const savedKey = window.localStorage.getItem("resolvedesk_gemini_key");
    if (savedKey) setGeminiApiKey(savedKey);
  }, []);

  const loadTickets = useCallback(async () => {
    setIsLoading(true);
    setTriageError(null);
    setActionBanner(null);
    try {
      const res = await fetch("/api/tickets?status=all");
      if (res.status === 401) {
        setSession(null);
        return;
      }
      const data = await res.json();
      if (data.tickets) {
        setTickets(data.tickets);
        if (data.organization) {
          setActiveOrg(data.organization);
        }
        setSelectedTicketId((prev) => {
          const exists = data.tickets.some((t: Ticket) => t.id === prev);
          return exists ? prev : data.tickets[0]?.id ?? null;
        });
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [recordDebug]);

  // Verificar sesión activa al cargar la página
  useEffect(() => {
    async function checkAuth() {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (data.demoOrgs) {
        setDemoOrgs(data.demoOrgs);
      }
      if (data.authenticated && data.session) {
        setSession(data.session);
        setActiveOrg(data.organization);
      }
      if (data._debug) {
        recordDebug(data._debug.endpoint, data._debug.sql);
      }
      setAuthChecked(true);
    }
    checkAuth();
  }, [recordDebug]);

  useEffect(() => {
    if (session?.userId) {
      loadTickets();
    }
  }, [session?.userId, loadTickets]);

  async function handleSsoLogin(userId: string) {
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.session) {
        setSession(data.session);
        setActiveOrg(data.organization);
        setStatusFilter("all");
        setActiveTab("tickets");
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    const res = await fetch("/api/auth/session", { method: "DELETE" });
    const data = await res.json();
    // Refrescar datos de cuotas en las tarjetas del portal SSO
    const sessionCheck = await fetch("/api/auth/session");
    const sessionData = await sessionCheck.json();
    if (sessionData.demoOrgs) {
      setDemoOrgs(sessionData.demoOrgs);
    }
    setSession(null);
    setActiveOrg(null);
    setTickets([]);
    if (data._debug) {
      recordDebug(data._debug.endpoint, data._debug.sql);
    }
  }

  const filteredTickets = useMemo(() => {
    if (statusFilter === "all") return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  const selectedPiiList = useMemo(
    () => parsePiiDetections(selectedTicket?.pii_stats ?? null),
    [selectedTicket?.pii_stats]
  );

  useEffect(() => {
    setReplyDraft(selectedTicket?.agent_reply ?? "");
    setTriageError(null);
    setActionBanner(null);
    setShowRedactedView(false);
  }, [selectedTicket?.id, selectedTicket?.agent_reply]);

  const counts = useMemo(() => {
    return {
      all: tickets.length,
      new: tickets.filter((t) => t.status === "new").length,
      open: tickets.filter((t) => t.status === "open").length,
      pending: tickets.filter((t) => t.status === "pending").length,
      solved: tickets.filter((t) => t.status === "solved").length,
    };
  }, [tickets]);

  async function handlePatchTicket(patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    agent_reply?: string;
  }) {
    if (!selectedTicket) return;
    setIsSaving(true);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ticket) {
        setTickets((prev) =>
          prev.map((t) => (t.id === data.ticket.id ? data.ticket : t))
        );
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteTicket() {
    if (!selectedTicket) return;
    setIsSaving(true);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setActionBanner(data.error || "Permiso denegado (HTTP 403).");
        recordDebug(
          `DELETE /api/tickets/${selectedTicket.id} -> 403 FORBIDDEN`,
          `-- Bloqueado por RBAC: rol '${session?.role}' intentó eliminar un ticket`
        );
        return;
      }
      const nextList = tickets.filter((t) => t.id !== selectedTicket.id);
      setTickets(nextList);
      setSelectedTicketId(nextList[0]?.id ?? null);
      if (data._debug) {
        recordDebug(data._debug.endpoint, data._debug.sql);
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunAiTriage() {
    if (!selectedTicket) return;
    setIsTriaging(true);
    setTriageError(null);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_api_key: geminiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTriageError(data.error || "Error al ejecutar el triaje con IA.");
        return;
      }
      if (data.ticket) {
        setTickets((prev) =>
          prev.map((t) => (t.id === data.ticket.id ? data.ticket : t))
        );
      }
      if (data.organization) {
        setActiveOrg(data.organization);
      }
      if (data._debug) {
        recordDebug(data._debug.endpoint, data._debug.sql);
      }
    } finally {
      setIsTriaging(false);
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setTriageError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: newChannel,
          requester_name: newRequesterName,
          requester_email: newRequesterEmail,
          priority: newPriority,
          subject: newSubject,
          description: newDescription,
          auto_triage: autoTriageOnCreate,
          gemini_api_key: geminiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (data.ticket) {
        setTickets((prev) => [data.ticket, ...prev]);
        setSelectedTicketId(data.ticket.id);
        setStatusFilter("all");
        setShowNewModal(false);
        setNewRequesterName("");
        setNewRequesterEmail("");
        setNewSubject("");
        setNewDescription("");
        if (data.organization) {
          setActiveOrg(data.organization);
        }
        if (data.triageWarning) {
          setTriageError(data.triageWarning);
        }
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleFillDemoPiiTicket() {
    setNewChannel("whatsapp");
    setNewPriority("normal");
    setNewRequesterName("Álvaro Domínguez");
    setNewRequesterEmail("alvaro.dominguez@correo.es");
    setNewSubject("Me habéis cobrado dos veces la suscripción y necesito reembolso");
    setNewDescription(
      "Hola! Acabo de ver dos cargos de 95€ en mi cuenta ES76 2077 0024 0031 0257 5766 asociados a mi DNI 51928374K. Mi móvil es +34 677 88 99 00 y el correo alvaro.dominguez@correo.es. Por favor devolvedme el cargo duplicado cuanto antes."
    );
  }

  function handleSaveApiKey(e: React.FormEvent) {
    e.preventDefault();
    const clean = geminiApiKey.trim();
    if (clean) {
      window.localStorage.setItem("resolvedesk_gemini_key", clean);
    } else {
      window.localStorage.removeItem("resolvedesk_gemini_key");
    }
    setShowApiModal(false);
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#03363D] text-white flex items-center justify-center text-sm">
        Verificando sesión corporativa SSO...
      </div>
    );
  }

  if (!session || !activeOrg) {
    return (
      <SsoLoginPortal
        demoOrgs={demoOrgs}
        isLoggingIn={isLoggingIn}
        onSelectUser={handleSsoLogin}
      />
    );
  }

  const quotaPct = Math.min(
    100,
    Math.round(
      (activeOrg.ai_resolutions_used / activeOrg.ai_resolutions_limit) * 100
    )
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      {/* =====================================================================
          BARRA SUPERIOR ESTILO ZENDESK SUITE ENTERPRISE (#03363D)
      ===================================================================== */}
      <header className="bg-[#03363D] text-white px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-teal-900 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-400 text-[#03363D] font-black flex items-center justify-center text-sm shadow-sm">
              RD
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-sm">
                  ResolveDesk AI
                </span>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
                  Fase 4 · Stripe Billing + ROI CX
                </span>
              </div>
              <p className="text-[11px] text-teal-200/80">
                Tenant activo: <strong>{activeOrg.name}</strong> ({activeOrg.plan.toUpperCase()})
              </p>
            </div>
          </div>

          {/* Pestañas de navegación principal */}
          <nav className="flex items-center bg-[#02282E] p-1 rounded-xl border border-teal-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("tickets")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === "tickets"
                  ? "bg-emerald-400 text-[#03363D]"
                  : "text-teal-100 hover:text-white"
              }`}
            >
              🎧 Consola de Tickets ({tickets.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("webhooks")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === "webhooks"
                  ? "bg-emerald-400 text-[#03363D]"
                  : "text-teal-100 hover:text-white"
              }`}
            >
              🔌 Integraciones & Webhooks
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("billing")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === "billing"
                  ? "bg-emerald-400 text-[#03363D]"
                  : "text-teal-100 hover:text-white"
              }`}
            >
              💳 Stripe Billing & ROI
            </button>
          </nav>
        </div>

        {/* Estado de Sesión SSO + Motor IA + Cuota */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <button
            type="button"
            onClick={() => setShowApiModal(true)}
            className="bg-[#02282E] hover:bg-teal-950 border border-teal-700 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer transition"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                geminiApiKey ? "bg-emerald-400" : "bg-sky-400"
              }`}
            />
            <span className="text-teal-200">
              IA: <strong className="text-white">{geminiApiKey ? "Gemini" : "Local"}</strong>
            </span>
          </button>

          <div className="bg-[#02282E] border border-teal-800 rounded-lg px-3 py-1 flex items-center gap-2">
            <div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-teal-300">Cuota IA:</span>
                <span className="font-mono font-bold text-white">
                  {activeOrg.ai_resolutions_used}/{activeOrg.ai_resolutions_limit}
                </span>
              </div>
              <div className="w-24 h-1.5 bg-teal-950 rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaPct >= 100
                      ? "bg-red-500"
                      : quotaPct >= 80
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`}
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bg-[#02282E] border border-teal-700 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
            <div>
              <span className="font-semibold text-white">{session.userName}</span>
              <span
                className={`ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  session.role === "admin"
                    ? "bg-emerald-400/20 text-emerald-300 border border-emerald-400/40"
                    : "bg-sky-400/20 text-sky-300 border border-sky-400/40"
                }`}
              >
                {session.role}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="px-2 py-1 rounded bg-teal-800 hover:bg-teal-700 text-teal-100 font-semibold text-[11px] cursor-pointer transition"
            >
              Cambiar SSO
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          CONTENIDO SEGÚN PESTAÑA ACTIVA: WEBHOOKS HUB vs CONSOLA DE TICKETS
      ===================================================================== */}
      {activeTab === "webhooks" ? (
        <WebhookIntegrationHub
          session={session}
          organization={activeOrg}
          geminiApiKey={geminiApiKey}
          onRecordDebug={recordDebug}
          onWebhookCreatedTicket={loadTickets}
        />
      ) : activeTab === "billing" ? (
        <BillingAndRoiDashboard
          session={session}
          organization={activeOrg}
          onOrganizationUpdated={setActiveOrg}
          onRecordDebug={recordDebug}
        />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* COLUMNA 1: VISTAS DE TICKETS */}
          <aside className="w-60 bg-white border-r border-slate-200 flex flex-col justify-between p-4 shrink-0">
            <div>
              <button
                onClick={() => setShowNewModal(true)}
                className="w-full py-2.5 px-3 rounded-lg bg-[#03363D] hover:bg-[#054a54] text-white font-semibold text-sm shadow-xs transition cursor-pointer flex items-center justify-center gap-2 mb-5"
              >
                <span>+ Simular Nuevo Ticket</span>
              </button>

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">
                Vistas de Cola ({activeOrg.slug})
              </div>

              <nav className="space-y-1 text-sm">
                {[
                  { key: "all", label: "Todos los tickets", count: counts.all },
                  { key: "new", label: "Nuevos", count: counts.new },
                  { key: "open", label: "Abiertos", count: counts.open },
                  { key: "pending", label: "Pendientes cliente", count: counts.pending },
                  { key: "solved", label: "Resueltos", count: counts.solved },
                ].map((view) => {
                  const active = statusFilter === view.key;
                  return (
                    <button
                      key={view.key}
                      onClick={() => setStatusFilter(view.key)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition cursor-pointer ${
                        active
                          ? "bg-teal-50 text-[#03363D] font-semibold border border-teal-200"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <span>{view.label}</span>
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                          active
                            ? "bg-[#03363D] text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {view.count}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
              <div className="font-bold text-slate-700 flex items-center justify-between">
                <span>Sesión Criptográfica</span>
                <span
                  className={`uppercase px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    activeOrg.plan === "enterprise"
                      ? "bg-purple-100 text-purple-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {activeOrg.plan}
                </span>
              </div>
              <div className="text-slate-500 truncate">{session.userEmail}</div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-slate-600">
                <span>Cookie:</span>
                <span className="font-mono text-[11px] font-semibold text-emerald-700">
                  HttpOnly HMAC
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Facturación MRR:</span>
                <span className="font-semibold">€{activeOrg.mrr_eur}/mes</span>
              </div>
            </div>
          </aside>

          {/* COLUMNA 2: LISTA DE TICKETS EN COLA */}
          <section className="w-96 bg-white border-r border-slate-200 flex flex-col min-h-0 shrink-0">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
              <h2 className="font-bold text-sm text-slate-800">
                Cola de Soporte ({filteredTickets.length})
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                tenant={activeOrg.id}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  Consultando base de datos SQL...
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No hay tickets en esta vista para {activeOrg.name}.
                </div>
              ) : (
                filteredTickets.map((ticket) => {
                  const isSelected = ticket.id === selectedTicket?.id;
                  const statusInfo = STATUS_META[ticket.status];
                  const priorityInfo = PRIORITY_META[ticket.priority];

                  return (
                    <button
                      key={ticket.id}
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={`w-full text-left p-4 transition cursor-pointer block ${
                        isSelected
                          ? "bg-teal-50/60 border-l-4 border-l-[#03363D]"
                          : "hover:bg-slate-50 border-l-4 border-l-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500">
                            {ticket.ticket_number}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            {CHANNEL_LABEL[ticket.channel]}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${statusInfo.badgeClass}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>

                      <div className="font-semibold text-sm text-slate-900 line-clamp-2 mb-1.5">
                        {ticket.subject}
                      </div>

                      {ticket.intent && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-teal-900/10 text-[#03363D] font-semibold">
                            ✨ {ticket.intent}
                          </span>
                          {ticket.sentiment && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${getSentimentBadgeClass(
                                ticket.sentiment
                              )}`}
                            >
                              {ticket.sentiment}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="truncate max-w-[170px]">
                          {ticket.requester_name}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${priorityInfo.badgeClass}`}
                        >
                          {priorityInfo.label}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* COLUMNA 3: DETALLE DE CONVERSACIÓN + PANEL LATERAL COPILOT */}
          <main className="flex-1 flex min-w-0 bg-slate-50 overflow-hidden">
            {selectedTicket ? (
              <>
                <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 space-y-5">
                  {actionBanner && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-900">
                      <div className="font-bold mb-0.5">
                        Política RBAC del Servidor (HTTP 403 Forbidden)
                      </div>
                      <div>{actionBanner}</div>
                    </div>
                  )}

                  {/* Cabecera del Ticket */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                          <span className="font-mono font-bold text-slate-700">
                            {selectedTicket.ticket_number}
                          </span>
                          <span>•</span>
                          <span>Canal: {CHANNEL_LABEL[selectedTicket.channel]}</span>
                          {selectedTicket.external_event_id && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                                event_id: {selectedTicket.external_event_id}
                              </span>
                            </>
                          )}
                          <span>•</span>
                          <span>
                            Cliente: <strong>{selectedTicket.requester_name}</strong> (
                            {selectedTicket.requester_email})
                          </span>
                        </div>
                        <h1 className="text-lg font-bold text-slate-900">
                          {selectedTicket.subject}
                        </h1>
                      </div>

                      <div className="flex flex-wrap items-end gap-2 text-xs">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-0.5">
                            Prioridad / SLA
                          </label>
                          <select
                            value={selectedTicket.priority}
                            disabled={isSaving}
                            onChange={(e) =>
                              handlePatchTicket({
                                priority: e.target.value as TicketPriority,
                              })
                            }
                            className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-medium text-slate-800 cursor-pointer"
                          >
                            <option value="low">Baja</option>
                            <option value="normal">Normal (SLA 24h)</option>
                            <option value="high">Alta (SLA 4h)</option>
                            <option value="urgent">Urgente (SLA 1h)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-0.5">
                            Estado
                          </label>
                          <select
                            value={selectedTicket.status}
                            disabled={isSaving}
                            onChange={(e) =>
                              handlePatchTicket({
                                status: e.target.value as TicketStatus,
                              })
                            }
                            className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-semibold text-slate-800 cursor-pointer"
                          >
                            <option value="new">Nuevo</option>
                            <option value="open">Abierto</option>
                            <option value="pending">Pendiente</option>
                            <option value="solved">Resuelto</option>
                          </select>
                        </div>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={handleDeleteTicket}
                          title="Eliminar ticket (requiere rol ADMIN)"
                          className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold cursor-pointer transition"
                        >
                          🗑️ Borrar
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mensaje entrante del cliente con conmutador GDPR */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">
                          {selectedTicket.requester_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {selectedTicket.requester_name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {showRedactedView
                              ? "Texto sanitizado que se envió al modelo de IA (cero fuga de PII)"
                              : "Mensaje original visible solo dentro del entorno seguro del Agente"}
                          </div>
                        </div>
                      </div>

                      {selectedTicket.redacted_description && (
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setShowRedactedView(false)}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              !showRedactedView
                                ? "bg-white text-slate-900 shadow-2xs"
                                : "text-slate-600"
                            }`}
                          >
                            Vista Agente
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRedactedView(true)}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              showRedactedView
                                ? "bg-emerald-700 text-white shadow-2xs"
                                : "text-slate-600"
                            }`}
                          >
                            🛡️ Prompt GDPR enviado al LLM
                          </button>
                        </div>
                      )}
                    </div>

                    <p
                      className={`text-sm leading-relaxed whitespace-pre-wrap p-3.5 rounded-lg border ${
                        showRedactedView
                          ? "bg-emerald-50/60 border-emerald-200 text-emerald-950 font-mono text-[13px]"
                          : "bg-slate-50 border-slate-100 text-slate-700"
                      }`}
                    >
                      {showRedactedView && selectedTicket.redacted_description
                        ? selectedTicket.redacted_description
                        : selectedTicket.description}
                    </p>
                  </div>

                  {/* Respuesta del Agente */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Respuesta pública como {session.userName}
                      </span>
                      {selectedTicket.agent_reply && (
                        <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                          Respuesta guardada en SQL
                        </span>
                      )}
                    </div>

                    <textarea
                      rows={5}
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder="Escribe una respuesta al cliente o inserta el borrador generado por Agent Copilot desde el panel derecho..."
                      className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#03363D] mb-3"
                    />

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isSaving || !replyDraft.trim()}
                        onClick={() =>
                          handlePatchTicket({
                            agent_reply: replyDraft,
                            status: "pending",
                          })
                        }
                        className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                      >
                        Enviar como Pendiente
                      </button>
                      <button
                        type="button"
                        disabled={isSaving || !replyDraft.trim()}
                        onClick={() =>
                          handlePatchTicket({
                            agent_reply: replyDraft,
                            status: "solved",
                          })
                        }
                        className="px-4 py-2 rounded-lg bg-[#03363D] hover:bg-[#054a54] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                      >
                        Enviar y marcar Resuelto
                      </button>
                    </div>
                  </div>
                </div>

                {/* PANEL DERECHO: INTELLIGENT TRIAGE & AGENT COPILOT */}
                <aside className="w-96 bg-white border-l border-slate-200 p-4 overflow-y-auto shrink-0 space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-slate-900">
                        Intelligent Triage & Copilot
                      </h3>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        Activo
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      1. Filtra PII (GDPR) → 2. Clasifica Intención/SLA → 3. Redacta respuesta
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isTriaging}
                    onClick={handleRunAiTriage}
                    className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isTriaging ? (
                      <span>Anonimizando PII y ejecutando IA...</span>
                    ) : selectedTicket.intent ? (
                      <span>↻ Re-analizar Ticket (Sin coste extra de cuota)</span>
                    ) : (
                      <span>✨ Ejecutar Intelligent Triage (1 Resolución IA)</span>
                    )}
                  </button>

                  {triageError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-2">
                      <div>
                        <div className="font-bold mb-0.5">
                          Aviso de Cuota SaaS (HTTP 402)
                        </div>
                        <div>{triageError}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("billing")}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-[#635BFF] hover:bg-[#5249f5] text-white font-semibold cursor-pointer transition"
                      >
                        💳 Ampliar Cuota en Stripe Billing →
                      </button>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        🛡️ Guardrail GDPR / PII
                      </span>
                      {selectedTicket.redacted_description ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          Protegido
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Pendiente</span>
                      )}
                    </div>

                    {selectedTicket.redacted_description ? (
                      selectedPiiList.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="text-slate-600">
                            Datos sensibles interceptados <strong>antes</strong> de salir hacia el modelo IA:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedPiiList.map((det) => (
                              <span
                                key={det.type}
                                className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-medium text-[11px]"
                              >
                                {det.count}× {det.type}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-600">
                          Escaneado completado: 0 datos sensibles detectados.
                        </p>
                      )
                    ) : (
                      <p className="text-slate-500">
                        Pulsa el botón superior para escanear DNI, IBAN, tarjetas, teléfonos y emails.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">
                        Intención Detectada (Intent)
                      </span>
                      <span className="font-bold text-slate-900 text-sm">
                        {selectedTicket.intent ?? "Sin clasificar aún"}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">
                        Sentimiento del Cliente
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded border text-xs font-semibold ${getSentimentBadgeClass(
                          selectedTicket.sentiment
                        )}`}
                      >
                        {selectedTicket.sentiment ?? "Sin analizar aún"}
                      </span>
                    </div>

                    {selectedTicket.ai_summary && (
                      <div className="p-3 rounded-xl bg-teal-50/50 border border-teal-200">
                        <span className="text-[#03363D] block text-[10px] uppercase font-bold mb-1">
                          Resumen Ejecutivo Copilot
                        </span>
                        <p className="text-slate-700 leading-relaxed">
                          {selectedTicket.ai_summary}
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedTicket.ai_suggested_reply && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 text-xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#03363D]">
                          🤖 Borrador de Agent Copilot
                        </span>
                        <span className="text-[10px] text-slate-500 truncate max-w-[140px]">
                          {selectedTicket.ai_engine}
                        </span>
                      </div>
                      <div className="bg-white rounded-lg border border-emerald-100 p-2.5 text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                        {selectedTicket.ai_suggested_reply}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setReplyDraft(selectedTicket.ai_suggested_reply ?? "")
                        }
                        className="w-full py-2 px-3 rounded-lg bg-[#03363D] hover:bg-[#054a54] text-white font-semibold cursor-pointer transition"
                      >
                        ↙ Insertar borrador en respuesta del Agente
                      </button>
                    </div>
                  )}
                </aside>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
                Selecciona un ticket de la cola para abrir el espacio de trabajo.
              </div>
            )}
          </main>
        </div>
      )}

      {/* =====================================================================
          INSPECTOR DIDÁCTICO EN VIVO: API REST + CONSULTA SQL EJECUTADA
      ===================================================================== */}
      <footer className="bg-slate-900 text-slate-200 px-5 py-2.5 text-xs font-mono flex flex-wrap items-center justify-between gap-4 border-t border-slate-700 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-sans font-bold text-[10px] uppercase shrink-0">
            Inspector Cloud en Vivo ({debugLog.timestamp})
          </span>
          <span className="text-sky-300 font-semibold shrink-0">
            {debugLog.endpoint}
          </span>
          <span className="text-slate-500">→</span>
          <span className="text-amber-200 truncate" title={debugLog.sql}>
            {debugLog.sql}
          </span>
        </div>
        <span className="text-[11px] text-slate-400 font-sans">
          Sesión: <code className="text-emerald-300">{session.role.toUpperCase()}</code> ·{" "}
          <code className="text-slate-200">data/resolvedesk.sqlite</code>
        </span>
      </footer>

      {/* MODAL CONFIGURAR GEMINI */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900">
                Configuración del Motor de IA (Cloud Adapter)
              </h3>
              <button
                onClick={() => setShowApiModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Por defecto la app funciona sin claves externas usando nuestro{" "}
              <strong>Motor NLP Local de Alta Disponibilidad</strong>. Si pegas una clave gratuita de{" "}
              <strong>Google AI Studio (Gemini API Key)</strong>, invocará en tiempo real{" "}
              <code className="font-mono bg-slate-100 px-1 rounded">gemini-2.5-flash</code>.
            </p>
            <form onSubmit={handleSaveApiKey} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Google Gemini API Key (Opcional)
                </label>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy... (vacío = motor local)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApiModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#03363D] text-white text-xs font-semibold hover:bg-[#054a54] cursor-pointer"
                >
                  Guardar Motor IA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL SIMULAR NUEVO TICKET */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Simular Ticket Entrante ({activeOrg.name})
                </h3>
                <p className="text-xs text-slate-500">
                  El Tenant se asigna automáticamente desde tu sesión SSO
                </p>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <button
              type="button"
              onClick={handleFillDemoPiiTicket}
              className="w-full mb-3 py-1.5 px-3 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-semibold cursor-pointer transition"
            >
              ⚡ Autorrellenar ejemplo realista con DNI, IBAN, Email y Teléfono
            </button>

            <form onSubmit={handleCreateTicket} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Canal Omnicanal
                  </label>
                  <select
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value as TicketChannel)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="web">Web Help Center</option>
                    <option value="whatsapp">WhatsApp Business</option>
                    <option value="email">Email Soporte</option>
                    <option value="api">Webhook API</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Prioridad Inicial
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) =>
                      setNewPriority(e.target.value as TicketPriority)
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="low">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre del Cliente
                  </label>
                  <input
                    required
                    type="text"
                    value={newRequesterName}
                    onChange={(e) => setNewRequesterName(e.target.value)}
                    placeholder="Ej. Lucía Fernández"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email del Cliente
                  </label>
                  <input
                    required
                    type="email"
                    value={newRequesterEmail}
                    onChange={(e) => setNewRequesterEmail(e.target.value)}
                    placeholder="lucia@cliente.es"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Asunto de la incidencia
                </label>
                <input
                  required
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ej. Cobro duplicado en tarjeta..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mensaje del cliente
                </label>
                <textarea
                  required
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Incluye datos sensibles ficticios (DNI, IBAN, teléfono)..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 bg-teal-50/70 border border-teal-200 rounded-lg p-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTriageOnCreate}
                  onChange={(e) => setAutoTriageOnCreate(e.target.checked)}
                  className="rounded"
                />
                <span>
                  <strong>Auto-Triaje Zendesk AI:</strong> anonimizar PII y clasificar automáticamente al crear
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-[#03363D] text-white text-xs font-semibold hover:bg-[#054a54] cursor-pointer"
                >
                  {isSaving ? "Procesando Ticket + IA..." : "Crear Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
