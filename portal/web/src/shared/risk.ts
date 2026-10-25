/* Risk band, due date and reminder rules — the same arithmetic the server applies (brief §8.1–8.2).
   The client uses these for live previews (triage sheet, action builder); the server recomputes on write. */
import type { Band, DueDateRule, RiskMatrixVersion } from "./types";
import { addWorkingDays } from "./format";

export function bandFor(matrix: RiskMatrixVersion | null | undefined, likelihood: number | null, severity: number | null): { score: number | null; band: Band | null } {
  if (!likelihood || !severity) return { score: null, band: null };
  const score = likelihood * severity;
  if (!matrix) return { score, band: score >= 15 ? "extreme" : score >= 8 ? "high" : score >= 4 ? "moderate" : "low" };
  const b = matrix.bands.find((x) => score >= x.min && score <= x.max);
  return { score, band: b?.band ?? null };
}

export function cellColour(matrix: RiskMatrixVersion | null | undefined, likelihood: number, severity: number): "green" | "amber" | "orange" | "red" {
  const { band } = bandFor(matrix, likelihood, severity);
  return band === "extreme" ? "red" : band === "high" ? "orange" : band === "moderate" ? "amber" : "green";
}

/** Default 5×5 matrix used until the server's version arrives (identical to the seed). */
export const DEFAULT_MATRIX: RiskMatrixVersion = {
  id: "default", matrixId: "default", name: "Default 5×5", size: 5, version: 1, status: "active", effectiveFrom: null,
  likelihoodLabels: [1, 2, 3, 4, 5].map((v) => ({ v, label: { en: ["", "Rare", "Unlikely", "Possible", "Likely", "Almost certain"][v] } })),
  severityLabels: [1, 2, 3, 4, 5].map((v) => ({ v, label: { en: ["", "First aid", "Medical treatment", "Restricted work / lost time", "Permanent partial disablement", "Fatality / permanent total"][v] } })),
  bands: [
    { band: "low", min: 1, max: 3, colour: "green", response: { en: "Monitor; fix within 90 days or at the next review." } },
    { band: "moderate", min: 4, max: 6, colour: "amber", response: { en: "Planned reduction within 30 days." } },
    { band: "high", min: 8, max: 12, colour: "orange", response: { en: "Continue only with approved interim controls; fix within 7 days." } },
    { band: "extreme", min: 15, max: 25, colour: "red", response: { en: "Stop or do not start; interim control this shift; fix within 72 hours." } },
  ],
  statusLabel: "design default",
};

export const DEFAULT_DUE_RULES: DueDateRule[] = [
  { id: "d-extreme", siteId: null, band: "extreme", dueAmount: 72, dueUnit: "hours", interimControlRequired: true, verifyWithinHours: 24, statusLabel: "design default" },
  { id: "d-high", siteId: null, band: "high", dueAmount: 7, dueUnit: "days", interimControlRequired: true, verifyWithinHours: 72, statusLabel: "design default" },
  { id: "d-moderate", siteId: null, band: "moderate", dueAmount: 30, dueUnit: "days", interimControlRequired: false, verifyWithinHours: 120, statusLabel: "design default" },
  { id: "d-low", siteId: null, band: "low", dueAmount: 90, dueUnit: "days", interimControlRequired: false, verifyWithinHours: 240, statusLabel: "design default" },
];

export function ruleFor(rules: DueDateRule[], band: Band, siteId: string | null): DueDateRule {
  return rules.find((r) => r.band === band && r.siteId === siteId) ?? rules.find((r) => r.band === band && r.siteId === null) ?? DEFAULT_DUE_RULES.find((r) => r.band === band)!;
}

export function dueFromRule(rule: DueDateRule, from: Date = new Date(), weeklyOff: number[] = [0]): Date {
  if (rule.dueUnit === "hours") return new Date(from.getTime() + rule.dueAmount * 3_600_000);
  if (rule.dueUnit === "working_days") return addWorkingDays(from, rule.dueAmount, weeklyOff);
  return new Date(from.getTime() + rule.dueAmount * 86_400_000);
}

/** IS 3786 cause code pre-set from the report type (brief §5.2). */
export function is3786Default(type: "good_practice" | "unsafe_act" | "unsafe_condition" | "near_miss"): "B-2" | "B-3" | "" {
  if (type === "unsafe_act") return "B-3";
  if (type === "unsafe_condition" || type === "near_miss") return "B-2";
  return "";
}
