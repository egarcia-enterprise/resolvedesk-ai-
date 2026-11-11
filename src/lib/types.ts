/**
 * Modelos de datos principales del SaaS (equivalente a las columnas de nuestras tablas SQL).
 * En TypeScript definimos la "forma" exacta de los datos para evitar errores entre Backend y Frontend.
 */

export type PlanTier = "starter" | "enterprise";
export type UserRole = "admin" | "agent";
export type TicketStatus = "new" | "open" | "pending" | "solved";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketChannel = "email" | "web" | "whatsapp" | "api";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: string;
  plan: PlanTier;
  seats_limit: number;
  ai_resolutions_used: number;
  ai_resolutions_limit: number;
  mrr_eur: number;
  created_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Ticket {
  id: string;
  organization_id: string; // Clave de aislamiento Multi-Tenant
  ticket_number: string;
  channel: TicketChannel;
  requester_name: string;
  requester_email: string;
  subject: string;
  description: string;
  redacted_description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  intent: string | null;
  sentiment: string | null;
  ai_suggested_reply: string | null;
  agent_reply: string | null;
  created_at: string;
  updated_at: string;
}
