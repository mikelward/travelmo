type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

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

// What a failure was, without its message, which may name an address or
// carry what a user wrote.
export function errorKind(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: typeof error };
  const { code, status } = error as { code?: unknown; status?: unknown };
  return { error: error.name, ...(code !== undefined ? { code } : {}), ...(status !== undefined ? { status } : {}) };
}
