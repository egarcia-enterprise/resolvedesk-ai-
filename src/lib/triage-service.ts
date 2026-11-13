import {
  getOrganizationById,
  getTicketByIdAndOrg,
  saveTicketAiTriage,
} from "./db";
import { redactSensitivePii } from "./pii-guardrail";
import { runIntelligentTriage } from "./ai-triage";

export class TriageServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * ORQUESTADOR EMPRESARIAL DE TRIAJE IA
 * Ejecuta en orden:
 * 1. Validación Multi-Tenant y de Cuota del Plan SaaS (Automated Resolutions).
 * 2. Guardrail GDPR: enmascara DNI, IBAN, tarjetas, emails y teléfonos.
 * 3. Llamada al motor de IA enviando ÚNICAMENTE el texto anonimizado.
 * 4. Persistencia en SQLite + actualización del contador de consumo del cliente.
 */
export async function processTicketWithAiGuardrails(
  orgId: string,
  ticketId: string,
  customApiKey?: string
) {
  const organization = getOrganizationById(orgId);
  if (!organization) {
    throw new TriageServiceError("Organización no encontrada.", 404, "ORG_NOT_FOUND");
  }

  const ticket = getTicketByIdAndOrg(orgId, ticketId);
  if (!ticket) {
    throw new TriageServiceError(
      "Ticket no encontrado o no pertenece a este Tenant.",
      404,
      "TICKET_NOT_FOUND"
    );
  }

  // Si es el primer triaje del ticket, verificamos que la empresa tenga cuota disponible
  const isFirstTriage = !ticket.intent;
  if (
    isFirstTriage &&
    organization.ai_resolutions_used >= organization.ai_resolutions_limit
  ) {
    throw new TriageServiceError(
      `Límite de cuota alcanzado (${organization.ai_resolutions_used}/${organization.ai_resolutions_limit} Automated Resolutions en plan ${organization.plan.toUpperCase()}). Requiere ampliación a Plan Enterprise.`,
      402,
      "QUOTA_EXCEEDED"
    );
  }

  // PASO 1: Anonimización GDPR / PII antes de tocar ningún LLM externo
  const subjectPii = redactSensitivePii(ticket.subject);
  const bodyPii = redactSensitivePii(ticket.description);

  // Consolidar estadísticas de PII detectado entre asunto y cuerpo
  const mergedMap = new Map<string, { placeholder: string; count: number }>();
  for (const det of [...subjectPii.detections, ...bodyPii.detections]) {
    const prev = mergedMap.get(det.type);
    mergedMap.set(det.type, {
      placeholder: det.placeholder,
      count: (prev?.count ?? 0) + det.count,
    });
  }
  const detections = Array.from(mergedMap.entries()).map(([type, val]) => ({
    type,
    placeholder: val.placeholder,
    count: val.count,
  }));

  // Extraer solo el nombre de pila (sin apellidos ni email) para personalizar el saludo sin exponer PII innecesario
  const requesterFirstName = ticket.requester_name.trim().split(/\s+/)[0] || "Cliente";

  // PASO 2: Ejecutar clasificación y redacción con IA sobre el texto YA ANONIMIZADO
  const aiResult = await runIntelligentTriage({
    organizationName: organization.name,
    industry: organization.industry,
    channel: ticket.channel,
    requesterFirstName,
    redactedSubject: subjectPii.redactedText,
    redactedDescription: bodyPii.redactedText,
    customApiKey,
  });

  // PASO 3: Guardar resultados en SQL y descontar 1 Automated Resolution si aplica
  const saved = saveTicketAiTriage(orgId, ticketId, {
    redactedDescription: bodyPii.redactedText,
    intent: aiResult.intent,
    sentiment: aiResult.sentiment,
    recommendedPriority: aiResult.recommendedPriority,
    summary: aiResult.summary,
    suggestedReply: aiResult.suggestedReply,
    engine: aiResult.engine,
    detections,
  });

  if (!saved) {
    throw new TriageServiceError("Error al guardar el triaje en SQL.", 500, "DB_ERROR");
  }

  return {
    ticket: saved.ticket,
    organization: saved.organization,
    consumedCredit: saved.consumedCredit,
    piiBlockedCount: subjectPii.totalRedacted + bodyPii.totalRedacted,
    detections,
    engine: aiResult.engine,
  };
}
