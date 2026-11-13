import type { PiiDetection } from "./types";

/**
 * GUARDRAIL DE PRIVACIDAD GDPR / PII (Equivalente a Zendesk Advanced Data Privacy)
 *
 * En ventas Enterprise en Europa, el CISO o el DPO siempre pregunta:
 * "¿Viajan el DNI, el IBAN o las tarjetas de mis clientes al proveedor de IA?"
 *
 * Este módulo intercepta y enmascara los datos personales ANTES de que el texto
 * salga de nuestro servidor hacia Google Gemini u otro LLM externo.
 */

interface RedactionRule {
  type: string;
  placeholder: string;
  regex: RegExp;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    type: "IBAN Bancario",
    placeholder: "[IBAN_OCULTO]",
    // Ejemplo: ES91 2100 0418 4502 0005 1332 o ES9121000418450200051332
    regex: /\b[A-Z]{2}\d{2}(?:\s?\d{4}){4,5}\b/gi,
  },
  {
    type: "Tarjeta Bancaria",
    placeholder: "[TARJETA_OCULTA]",
    // Tarjetas completas de 16 dígitos o mención explícita "terminada en 4532"
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b|(?<=terminad[ao]\s+en\s+)\d{4}\b/gi,
  },
  {
    type: "DNI / NIE / NIF",
    placeholder: "[DNI_NIF_OCULTO]",
    // DNI (8 dígitos + letra), NIE (X/Y/Z + 7 dígitos + letra) o CIF empresarial (A-W + 8 dígitos)
    regex: /\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])\b/gi,
  },
  {
    type: "Email Personal",
    placeholder: "[EMAIL_OCULTO]",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: "Teléfono",
    placeholder: "[TELEFONO_OCULTO]",
    // Móviles/fijos españoles (+34 opcional + 9 dígitos empezando por 6, 7, 8 o 9)
    regex: /(?:\+34[\s-]?)?\b[6789]\d{2}[\s.-]?\d{2,3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g,
  },
];

export interface PiiRedactionResult {
  redactedText: string;
  totalRedacted: number;
  detections: PiiDetection[];
}

export function redactSensitivePii(rawText: string): PiiRedactionResult {
  let redactedText = rawText;
  const detections: PiiDetection[] = [];
  let totalRedacted = 0;

  for (const rule of REDACTION_RULES) {
    const matches = redactedText.match(rule.regex);
    if (matches && matches.length > 0) {
      detections.push({
        type: rule.type,
        placeholder: rule.placeholder,
        count: matches.length,
      });
      totalRedacted += matches.length;
      redactedText = redactedText.replace(rule.regex, rule.placeholder);
    }
  }

  return {
    redactedText,
    totalRedacted,
    detections,
  };
}
