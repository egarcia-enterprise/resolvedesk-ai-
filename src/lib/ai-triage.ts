import type { TicketChannel, TicketPriority } from "./types";

/**
 * MOTOR DE IA: INTELLIGENT TRIAGE & AGENT COPILOT
 *
 * Patrón Cloud "Provider Adapter + Graceful Fallback":
 * 1. Si hay configurada una clave de Google Gemini (GEMINI_API_KEY), invoca `gemini-2.5-flash`
 *    pidiendo una respuesta JSON estructurada estricta (Structured Outputs).
 * 2. Si no hay clave configurada (o falla la red externa), conmuta automáticamente al motor
 *    heurístico local para que el centro de soporte nunca se detenga (Alta Disponibilidad).
 */

export interface TriageInput {
  organizationName: string;
  industry: string;
  channel: TicketChannel;
  requesterFirstName: string;
  redactedSubject: string;
  redactedDescription: string;
  customApiKey?: string;
}

export interface TriageOutput {
  intent: string;
  sentiment: string;
  recommendedPriority: TicketPriority;
  summary: string;
  suggestedReply: string;
  engine: string;
}

export async function runIntelligentTriage(
  input: TriageInput
): Promise<TriageOutput> {
  const apiKey = input.customApiKey?.trim() || process.env.GEMINI_API_KEY?.trim();

  if (apiKey) {
    try {
      return await callGeminiStructuredTriage(input, apiKey);
    } catch (error) {
      console.warn(
        "[AI Fallback] Error llamando a Gemini API, usando motor local de respaldo:",
        error
      );
    }
  }

  return runLocalResilientTriage(input);
}

async function callGeminiStructuredTriage(
  input: TriageInput,
  apiKey: string
): Promise<TriageOutput> {
  const prompt = `
Eres el motor de IA empresarial (estilo Zendesk Intelligent Triage & Agent Copilot) de la empresa "${input.organizationName}" (${input.industry}).
Analiza este ticket de soporte entrante por el canal "${input.channel}".
NOTA: El texto ya ha pasado por nuestro filtro GDPR y los datos sensibles aparecen como [DNI_NIF_OCULTO], [IBAN_OCULTO], etc. No pidas de nuevo datos sensibles innecesarios.

Nombre de pila del cliente: ${input.requesterFirstName}
Asunto anonimizado: ${input.redactedSubject}
Mensaje anonimizado: ${input.redactedDescription}

Devuelve ÚNICAMENTE un objeto JSON válido con estas claves exactas:
- "intent": categoría corta en español (ej. "Facturación · Cobro Duplicado", "Incidencia Técnica API", "Logística · Devoluciones", "Administración · Facturas")
- "sentiment": uno de ["Muy Negativo · Riesgo Churn", "Frustrado", "Neutro", "Positivo"]
- "recommendedPriority": uno de ["urgent", "high", "normal", "low"]
- "summary": resumen ejecutivo de 1 frase para el agente de soporte (máx 25 palabras)
- "suggestedReply": borrador de respuesta empática, profesional y resolutiva en español dirigida a ${input.requesterFirstName} en nombre del equipo de soporte de ${input.organizationName}.
`.trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const rawContent = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawContent) {
    throw new Error("Respuesta vacía del modelo Gemini.");
  }

  const parsed = JSON.parse(rawContent) as Partial<TriageOutput>;
  const validPriorities: TicketPriority[] = ["low", "normal", "high", "urgent"];
  const priority: TicketPriority = validPriorities.includes(
    parsed.recommendedPriority as TicketPriority
  )
    ? (parsed.recommendedPriority as TicketPriority)
    : "normal";

  return {
    intent: parsed.intent || "Consulta General",
    sentiment: parsed.sentiment || "Neutro",
    recommendedPriority: priority,
    summary:
      parsed.summary ||
      "Ticket analizado automáticamente por Gemini Intelligent Triage.",
    suggestedReply:
      parsed.suggestedReply ||
      `Hola ${input.requesterFirstName}, hemos recibido tu solicitud en ${input.organizationName} y estamos revisándola con prioridad.`,
    engine: "Google Gemini 2.5 Flash (Cloud API)",
  };
}

/**
 * Motor determinista local para demostraciones offline sin necesidad de API Key externa.
 */
function runLocalResilientTriage(input: TriageInput): TriageOutput {
  const combined = `${input.redactedSubject} ${input.redactedDescription}`.toLowerCase();
  const name = input.requesterFirstName || "cliente";

  // 1. Detectar Intención (Intent)
  let intent = "Consulta General de Soporte";
  let recommendedPriority: TicketPriority = "normal";
  let sentiment = "Neutro";
  let summary = "";
  let suggestedReply = "";

  if (
    combined.includes("duplicado") ||
    combined.includes("cargado") ||
    combined.includes("dos veces") ||
    combined.includes("abono")
  ) {
    intent = "Facturación · Cobro Duplicado";
    recommendedPriority = "urgent";
    sentiment = "Muy Negativo · Riesgo Churn";
    summary =
      "Cliente reporta cargo duplicado en tarjeta y solicita reembolso inmediato con riesgo de reclamación.";
    suggestedReply = `Hola ${name},\n\nSentimos mucho las molestias ocasionadas por el cargo duplicado. Hemos escalado tu incidencia con prioridad urgente a nuestro equipo de Pagos de ${input.organizationName} para anular la retención duplicada y procesar el abono hoy mismo (reflejado en tu entidad en 24-48h hábiles).\n\nPor tu seguridad, hemos protegido tus datos identificativos en nuestro sistema conforme a GDPR. Te confirmaremos el justificante de devolución en breve.\n\nUn saludo,\nEquipo de Atención al Cliente — ${input.organizationName}`;
  } else if (
    combined.includes("502") ||
    combined.includes("error") ||
    combined.includes("tpv") ||
    combined.includes("caída") ||
    combined.includes("no pueden pagar")
  ) {
    intent = "Incidencia Crítica · Pasarela / API";
    recommendedPriority = "urgent";
    sentiment = "Muy Negativo · Riesgo Churn";
    summary =
      "Caída en producción (HTTP 502) bloqueando cobros del comercio en tiempo real; impacto directo en ingresos.";
    suggestedReply = `Hola equipo de ${name},\n\nHemos detectado vuestra alerta crítica sobre el error HTTP 502 en el TPV Virtual y ya está asignada a Ingeniería de Guardia (Nivel 2) de ${input.organizationName} bajo SLA Crítico (<1h).\n\nHemos activado el enrutamiento de respaldo para restablecer vuestros cobros de inmediato y os enviaremos actualización técnica en los próximos 15 minutos.\n\nAtentamente,\nSoporte Técnico Enterprise — ${input.organizationName}`;
  } else if (
    combined.includes("talla") ||
    combined.includes("recogida") ||
    combined.includes("lote") ||
    combined.includes("corporativo")
  ) {
    intent = "Logística B2B · Cambio de Pedido";
    recommendedPriority = "high";
    sentiment = "Frustrado";
    summary =
      "Cliente corporativo solicita cambio urgente de tallas y recogida logística antes de evento esta semana.";
    suggestedReply = `Buenos días ${name},\n\nGracias por avisarnos. Ya hemos pre-reservado las unidades de reemplazo en almacén central de ${input.organizationName} con envío prioritario 24h para llegar antes de vuestro evento del viernes, coordinando en el mismo viaje la recogida de las prendas actuales.\n\n¿Nos confirmas la franja horaria de recepción en vuestras oficinas para cerrar la orden con el transportista?\n\nUn cordial saludo,\nOperaciones B2B — ${input.organizationName}`;
  } else if (
    combined.includes("devolver") ||
    combined.includes("devolución") ||
    combined.includes("tienda física") ||
    combined.includes("qr")
  ) {
    intent = "Postventa · Política de Devolución";
    recommendedPriority = "low";
    sentiment = "Positivo";
    summary =
      "Consulta informativa estándar sobre plazo y procedimiento de devolución gratuita en tienda con QR.";
    suggestedReply = `¡Hola ${name}!\n\nEfectivamente: dispones de 30 días naturales desde la recepción de tu pedido para realizar la devolución de forma totalmente gratuita en cualquiera de nuestras tiendas físicas de ${input.organizationName}, mostrando únicamente el código QR desde la app.\n\nSi necesitas que te indiquemos tu tienda más cercana, dínoslo y encantados te ayudamos.\n\n¡Gracias por confiar en nosotros!`;
  } else if (
    combined.includes("retraso") ||
    combined.includes("transportista") ||
    combined.includes("aduana") ||
    combined.includes("envío")
  ) {
    intent = "Logística · Incidencia de Transporte";
    recommendedPriority = "high";
    sentiment = "Frustrado";
    summary =
      "Incidencia logística en tránsito que afecta plazos de entrega comprometidos (SLA de envío).";
    suggestedReply = `Hola ${name},\n\nHemos registrado la incidencia logística asociada al envío y abierto reclamación prioritaria con la agencia de transporte desde ${input.organizationName} para desbloquear la entrega a la mayor brevedad.\n\nTe mantendremos informado de cada avance en este mismo hilo.\n\nSaludos cordiales,\nEquipo de Operaciones — ${input.organizationName}`;
  } else if (
    combined.includes("factura") ||
    combined.includes("comisiones") ||
    combined.includes("gestoría") ||
    combined.includes("pdf")
  ) {
    intent = "Administración · Facturación y Tasas";
    recommendedPriority = "normal";
    sentiment = "Neutro";
    summary =
      "Solicitud administrativa sobre descarga de facturas mensuales y desglose de comisiones en PDF.";
    suggestedReply = `Hola ${name},\n\nPuedes descargar el certificado y las facturas mensuales en PDF directamente desde tu panel de cliente de ${input.organizationName} entrando en **Configuración > Facturación > Liquidaciones Mensuales**.\n\nSi prefieres que te adjuntemos el PDF de octubre directamente por esta vía, confírmanoslo y te lo generamos al instante.\n\nUn saludo,\nAdministración y Soporte — ${input.organizationName}`;
  } else {
    // Detección adicional de urgencia/enfado para cualquier texto libre que invente el usuario
    if (
      combined.includes("urgente") ||
      combined.includes("indignado") ||
      combined.includes("reclamación") ||
      combined.includes("bloqueado") ||
      combined.includes("nadie responde")
    ) {
      recommendedPriority = "urgent";
      sentiment = "Frustrado";
    }
    summary = `Solicitud recibida vía ${input.channel} sobre "${input.redactedSubject}" pendiente de gestión por especialista.`;
    suggestedReply = `Hola ${name},\n\nGracias por contactar con el equipo de soporte de ${input.organizationName}. Hemos revisado los detalles de tu solicitud sobre "${input.redactedSubject}" (protegiendo automáticamente cualquier dato sensible conforme a nuestra política GDPR) y un especialista ya está gestionando tu caso.\n\nTe daremos una solución detallada muy pronto.\n\nUn cordial saludo,\nAtención al Cliente — ${input.organizationName}`;
  }

  return {
    intent,
    sentiment,
    recommendedPriority,
    summary,
    suggestedReply,
    engine: "Motor NLP Local (Alta Disponibilidad)",
  };
}
