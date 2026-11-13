/**
 * Modelos de datos principales del SaaS (equivalente a las columnas de nuestras tablas SQL).
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
  api_key?: string;
  created_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthSession {
  userId: string;
  organizationId: string;
  role: UserRole;
  userName: string;
  userEmail: string;
  exp: number;
}

export interface PiiDetection {
  type: string;
  placeholder: string;
  count: number;
}

export interface Ticket {
  id: string;
  organization_id: string;
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
  ai_summary: string | null;
  ai_suggested_reply: string | null;
  ai_engine: string | null;
  pii_stats: string | null;
  agent_reply: string | null;
  external_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookLog {
  id: string;
  organization_id: string;
  source_system: string;
  external_event_id: string | null;
  status_code: number;
  outcome: string;
  ticket_number: string | null;
  created_at: string;
}

export interface BillingEvent {
  id: string;
  organization_id: string;
  stripe_event_id: string;
  event_type: string;
  amount_eur: number;
  description: string;
  created_at: string;
}
