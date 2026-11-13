"use client";

import React from "react";
import type { Organization, User } from "@/lib/types";

export interface DemoOrgWithUsers extends Organization {
  users: User[];
}

interface SsoLoginPortalProps {
  demoOrgs: DemoOrgWithUsers[];
  isLoggingIn: boolean;
  onSelectUser: (userId: string) => void;
}

export default function SsoLoginPortal({
  demoOrgs,
  isLoggingIn,
  onSelectUser,
}: SsoLoginPortalProps) {
  return (
    <div className="min-h-screen bg-[#03363D] flex flex-col items-center justify-center p-6 text-slate-900">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-2xl border border-teal-800 overflow-hidden">
        {/* Cabecera corporativa */}
        <div className="bg-[#02282E] text-white px-8 py-6 border-b border-teal-900 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-400 text-[#03363D] font-black flex items-center justify-center text-base">
              RD
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">
                  ResolveDesk AI · Enterprise SSO
                </h1>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                  Fase 3 · Auth + RBAC
                </span>
              </div>
              <p className="text-xs text-teal-200/80 mt-0.5">
                Inicia sesión con 1 clic para probar aislamiento Multi-Tenant por Cookie firmada (HMAC-SHA256) y permisos por Rol
              </p>
            </div>
          </div>
        </div>

        {/* Selección de Organizaciones y Roles */}
        <div className="p-8 space-y-6">
          <div className="rounded-xl bg-teal-50/70 border border-teal-200 p-4 text-xs text-slate-700 leading-relaxed">
            <strong className="text-[#03363D]">
              ¿Qué estamos demostrando aquí?
            </strong>{" "}
            A diferencia de un prototipo básico, el servidor ahora exige una{" "}
            <strong>sesión criptográfica (`HttpOnly Cookie`)</strong>. El{" "}
            <code className="font-mono bg-white px-1 py-0.5 rounded border border-teal-200">
              organization_id
            </code>{" "}
            y el rol (<code className="font-mono">ADMIN</code> vs{" "}
            <code className="font-mono">AGENT</code>) viajan firmados en el token: ningún cliente puede ver datos de otra empresa ni ejecutar acciones de administrador sin permiso.
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {demoOrgs.map((org) => (
              <div
                key={org.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h2 className="font-bold text-base text-slate-900">
                      {org.name}
                    </h2>
                    <span
                      className={`uppercase text-[10px] font-bold px-2 py-0.5 rounded ${
                        org.plan === "enterprise"
                          ? "bg-purple-100 text-purple-800 border border-purple-200"
                          : "bg-amber-100 text-amber-900 border border-amber-200"
                      }`}
                    >
                      Plan {org.plan} · €{org.mrr_eur}/mes
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">
                    {org.industry} • Cuota IA: {org.ai_resolutions_used}/
                    {org.ai_resolutions_limit} resoluciones
                  </p>

                  <div className="space-y-2.5">
                    {org.users.map((user) => {
                      const isAdmin = user.role === "admin";
                      return (
                        <button
                          key={user.id}
                          type="button"
                          disabled={isLoggingIn}
                          onClick={() => onSelectUser(user.id)}
                          className="w-full text-left bg-white hover:bg-teal-50/60 border border-slate-200 hover:border-[#03363D] rounded-xl p-3.5 transition shadow-2xs cursor-pointer flex items-center justify-between gap-3 group"
                        >
                          <div>
                            <div className="font-semibold text-sm text-slate-900 group-hover:text-[#03363D]">
                              {user.name}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">
                              {user.email}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">
                              {isAdmin
                                ? "Acceso total: Tickets + API Keys + Webhooks + Borrado"
                                : "Acceso restringido: Gestión de Tickets + Copilot (Sin Admin API)"}
                            </div>
                          </div>

                          <span
                            className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg border ${
                              isAdmin
                                ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                : "bg-sky-100 text-sky-900 border-sky-300"
                            }`}
                          >
                            {user.role} →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
