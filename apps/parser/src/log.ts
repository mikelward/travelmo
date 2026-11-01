type Severity = "INFO" | "WARNING" | "ERROR";

// One JSON object per line is what Cloud Logging parses into structured entries.
export function log(severity: Severity, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ severity, event, ...fields, time: new Date().toISOString() });
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error: error.message, stack: error.stack };
  return { error: String(error) };
}
