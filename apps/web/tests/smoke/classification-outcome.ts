export interface StructuredClassificationFields {
  category?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  summary?: string | null;
  priorityScore?: number | null;
  priorityBand?: string | null;
}

/** True only when the worker persisted a contract-valid, scored AI result. */
export function hasStructuredClassification(report: StructuredClassificationFields): boolean {
  return (
    typeof report.category === 'string' &&
    typeof report.urgency === 'string' &&
    typeof report.confidence === 'number' &&
    typeof report.summary === 'string' &&
    typeof report.priorityScore === 'number' &&
    typeof report.priorityBand === 'string'
  );
}
