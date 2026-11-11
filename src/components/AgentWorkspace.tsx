"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Organization,
  Ticket,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  User,
} from "@/lib/types";

interface OrgWithUsers extends Organization {
  users: User[];
}

interface DebugLog {
  endpoint: string;
  sql: string;
  timestamp: string;
}

const STATUS_META: Record<
  TicketStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  new: {
    label: "Nuevo",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
    dotClass: "bg-amber-500",
  },
  open: {
    label: "Abierto",
    badgeClass: "bg-rose-100 text-rose-900 border-rose-300",
    dotClass: "bg-rose-500",
  },
  pending: {
    label: "Pendiente",
    badgeClass: "bg-sky-100 text-sky-900 border-sky-300",
    dotClass: "bg-sky-500",
  },
  solved: {
    label: "Resuelto",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
    dotClass: "bg-emerald-500",
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

export default function AgentWorkspace() {
  const [organizations, setOrganizations] = useState<OrgWithUsers[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("org_retail");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [debugLog, setDebugLog] = useState<DebugLog>({
    endpoint: "GET /api/organizations",
    sql: "SELECT * FROM organizations ORDER BY mrr_eur DESC;",
    timestamp: "--:--:--",
  });

  // Campos del formulario para simular la llegada de un nuevo ticket
  const [newChannel, setNewChannel] = useState<TicketChannel>("web");
  const [newRequesterName, setNewRequesterName] = useState<string>("");
  const [newRequesterEmail, setNewRequesterEmail] = useState<string>("");
  const [newPriority, setNewPriority] = useState<TicketPriority>("normal");
  const [newSubject, setNewSubject] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");

  const recordDebug = useCallback((endpoint: string, sql: string) => {
    const now = new Date().toLocaleTimeString("es-ES", { hour12: false });
    setDebugLog({ endpoint, sql, timestamp: now });
  }, []);

  // 1. Cargar las empresas clientes (Tenants) al abrir la aplicación
  useEffect(() => {
    async function loadOrgs() {
      const res = await fetch("/api/organizations");
      const data = await res.json();
      if (data.organizations?.length) {
        setOrganizations(data.organizations);
        const defaultOrg = data.organizations[0] as OrgWithUsers;
        setSelectedOrgId(defaultOrg.id);
        if (defaultOrg.users?.length) {
          setSelectedUserId(defaultOrg.users[0].id);
        }
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    }
    loadOrgs();
  }, [recordDebug]);

  // 2. Cargar los tickets aislados cada vez que cambiamos de Empresa (Tenant)
  const loadTickets = useCallback(
    async (orgId: string) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tickets?orgId=${orgId}&status=all`);
        const data = await res.json();
        if (data.tickets) {
          setTickets(data.tickets);
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
    },
    [recordDebug]
  );

  useEffect(() => {
    if (selectedOrgId) {
      loadTickets(selectedOrgId);
    }
  }, [selectedOrgId, loadTickets]);

  const activeOrg = useMemo(
    () => organizations.find((o) => o.id === selectedOrgId),
    [organizations, selectedOrgId]
  );

  const activeUser = useMemo(
    () => activeOrg?.users.find((u) => u.id === selectedUserId) ?? activeOrg?.users[0],
    [activeOrg, selectedUserId]
  );

  const filteredTickets = useMemo(() => {
    if (statusFilter === "all") return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  // Sincronizar el cuadro de respuesta cuando seleccionamos otro ticket
  useEffect(() => {
    setReplyDraft(selectedTicket?.agent_reply ?? "");
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

  function handleSwitchOrg(nextOrgId: string) {
    setSelectedOrgId(nextOrgId);
    setStatusFilter("all");
    const nextOrg = organizations.find((o) => o.id === nextOrgId);
    if (nextOrg?.users?.length) {
      setSelectedUserId(nextOrg.users[0].id);
    }
  }

  async function handlePatchTicket(patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    agent_reply?: string;
  }) {
    if (!selectedTicket) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: selectedOrgId,
          ...patch,
        }),
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

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: selectedOrgId,
          channel: newChannel,
          requester_name: newRequesterName,
          requester_email: newRequesterEmail,
          priority: newPriority,
          subject: newSubject,
          description: newDescription,
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
        if (data._debug) {
          recordDebug(data._debug.endpoint, data._debug.sql);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  const quotaPct = activeOrg
    ? Math.min(
        100,
        Math.round(
          (activeOrg.ai_resolutions_used / activeOrg.ai_resolutions_limit) * 100
        )
      )
    : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      {/* =====================================================================
          BARRA SUPERIOR ESTILO ZENDESK SUITE ENTERPRISE (#03363D)
      ===================================================================== */}
      <header className="bg-[#03363D] text-white px-5 py-3 flex flex-wrap items-center justify-between gap-4 border-b border-teal-900 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-400 text-[#03363D] font-black flex items-center justify-center text-sm shadow-sm">
            RD
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-base">
                ResolveDesk AI
              </span>
              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-teal-900/90 text-emerald-300 border border-teal-700 font-semibold">
                Fase 1 · Multi-Tenant SQL
              </span>
            </div>
            <p className="text-xs text-teal-200/80">
              Agent Workspace inspirado en Zendesk Suite Enterprise
            </p>
          </div>
        </div>

        {/* Selector Multi-Tenant + Rol RBAC + Cuota IA */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="bg-[#02282E] border border-teal-800 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className="text-teal-300 font-medium">Tenant (Cliente):</span>
            <select
              value={selectedOrgId}
              onChange={(e) => handleSwitchOrg(e.target.value)}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id} className="text-slate-900">
                  {org.name} ({org.plan.toUpperCase()} · €{org.mrr_eur} MRR)
                </option>
              ))}
            </select>
          </div>

          {activeOrg && (
            <div className="bg-[#02282E] border border-teal-800 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <span className="text-teal-300 font-medium">Sesión RBAC:</span>
              <select
                value={activeUser?.id ?? ""}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
              >
                {activeOrg.users.map((u) => (
                  <option key={u.id} value={u.id} className="text-slate-900">
                    {u.name} [{u.role.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeOrg && (
            <div className="bg-[#02282E] border border-teal-800 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-teal-300">Automated Resolutions:</span>
                  <span className="font-mono font-bold text-white">
                    {activeOrg.ai_resolutions_used}/{activeOrg.ai_resolutions_limit}
                  </span>
                </div>
                <div className="w-36 h-1.5 bg-teal-950 rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full rounded-full ${
                      quotaPct >= 80 ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                    style={{ width: `${quotaPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* =====================================================================
          CUERPO CENTRAL: 3 COLUMNAS DE ZENDESK AGENT WORKSPACE
      ===================================================================== */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* COLUMNA 1: VISTAS DE TICKETS (Views Sidebar) */}
        <aside className="w-60 bg-white border-r border-slate-200 flex flex-col justify-between p-4 shrink-0">
          <div>
            <button
              onClick={() => setShowNewModal(true)}
              className="w-full py-2.5 px-3 rounded-lg bg-[#03363D] hover:bg-[#054a54] text-white font-semibold text-sm shadow-xs transition cursor-pointer flex items-center justify-center gap-2 mb-5"
            >
              <span>+ Simular Nuevo Ticket</span>
            </button>

            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">
              Vistas de Cola ({activeOrg?.slug})
            </div>

            <nav className="space-y-1 text-sm">
              {[
                { key: "all", label: "Todos los tickets", count: counts.all },
                { key: "new", label: "Nuevos (Sin triaje)", count: counts.new },
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

          {activeOrg && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
              <div className="font-bold text-slate-700 flex items-center justify-between">
                <span>Datos del Contrato</span>
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
              <div className="text-slate-500">{activeOrg.industry}</div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-slate-600">
                <span>Licencias Agente:</span>
                <span className="font-semibold">{activeOrg.seats_limit} seats</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Facturación MRR:</span>
                <span className="font-semibold">€{activeOrg.mrr_eur}/mes</span>
              </div>
            </div>
          )}
        </aside>

        {/* COLUMNA 2: LISTA DE TICKETS EN COLA */}
        <section className="w-96 bg-white border-r border-slate-200 flex flex-col min-h-0 shrink-0">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
            <h2 className="font-bold text-sm text-slate-800">
              Cola de Soporte ({filteredTickets.length})
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              tenant_id={selectedOrgId}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Consultando base de datos SQL...
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No hay tickets en esta vista para {activeOrg?.name}.
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
              {/* Hilo central del ticket */}
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 space-y-5">
                {/* Cabecera del Ticket con selectores que actualizan SQL */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <span className="font-mono font-bold text-slate-700">
                          {selectedTicket.ticket_number}
                        </span>
                        <span>•</span>
                        <span>Canal: {CHANNEL_LABEL[selectedTicket.channel]}</span>
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

                    <div className="flex items-center gap-2 text-xs">
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
                          Estado del Ticket
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
                    </div>
                  </div>
                </div>

                {/* Mensaje entrante del cliente */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">
                        {selectedTicket.requester_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {selectedTicket.requester_name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Mensaje entrante original (contiene posibles datos PII sin anonimizar)
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {new Date(selectedTicket.created_at).toLocaleString("es-ES")}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                    {selectedTicket.description}
                  </p>
                </div>

                {/* Respuesta del Agente (Composer) */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Respuesta pública como {activeUser?.name}
                    </span>
                    {selectedTicket.agent_reply && (
                      <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                        Respuesta guardada en SQL
                      </span>
                    )}
                  </div>

                  <textarea
                    rows={4}
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    placeholder="Escribe una respuesta al cliente..."
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

              {/* Panel derecho: Zendesk Intelligent Triage & Copilot (listo para Fase 2) */}
              <aside className="w-80 bg-white border-l border-slate-200 p-4 overflow-y-auto shrink-0 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Intelligent Triage & Copilot
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Módulo IA de Zendesk Enterprise
                    </p>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                    Próximo: Fase 2
                  </span>
                </div>

                <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/40 p-3.5 text-xs space-y-2.5">
                  <div className="font-semibold text-[#03363D]">
                    ¿Qué activaremos aquí en la Fase 2?
                  </div>
                  <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                    <li>
                      <strong>Guardrail GDPR / PII:</strong> Ocultará automáticamente DNI, IBAN, tarjetas y teléfonos antes de enviar el ticket al modelo de IA.
                    </li>
                    <li>
                      <strong>Intelligent Triage:</strong> Clasificará Intención, Sentimiento y Prioridad automáticamente.
                    </li>
                    <li>
                      <strong>Agent Copilot:</strong> Redactará una respuesta lista para insertar con 1 clic.
                    </li>
                  </ul>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      Intención detectada (Intent)
                    </span>
                    <span className="font-medium text-slate-600">
                      {selectedTicket.intent ?? "Sin clasificar aún"}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      Sentimiento del cliente
                    </span>
                    <span className="font-medium text-slate-600">
                      {selectedTicket.sentiment ?? "Sin analizar aún"}
                    </span>
                  </div>
                </div>
              </aside>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
              Selecciona un ticket de la cola para abrir el espacio de trabajo.
            </div>
          )}
        </main>
      </div>

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
          Base de datos: <code className="text-slate-200">data/resolvedesk.sqlite</code>
        </span>
      </footer>

      {/* =====================================================================
          MODAL PARA SIMULAR ENTRADA DE UN NUEVO TICKET DE CLIENTE
      ===================================================================== */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Simular Ticket Entrante ({activeOrg?.name})
                </h3>
                <p className="text-xs text-slate-500">
                  Enviará un <code className="font-mono">POST /api/tickets</code> aislado para <code className="font-mono">{selectedOrgId}</code>
                </p>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3.5 text-sm">
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
                  placeholder="Ej. Pedido bloqueado en aduanas con DNI..."
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
                  placeholder="Describe el problema del cliente (puedes incluir un DNI o teléfono ficticio para probar la anonimización en la Fase 2)..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

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
                  {isSaving ? "Guardando en SQL..." : "Crear Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
