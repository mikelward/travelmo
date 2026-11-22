import { log } from "./log";

// Secret Manager returns a secret exactly as it was stored, so one pasted
// with a final Enter carries a newline into the environment, and Google then
// rejects it as a credential (`invalid_client`). No setting means anything
// by a trailing line break, so drop them all before anything reads one.
export function trimLineEnds(env: Record<string, string | undefined>): string[] {
  const trimmed: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !/[\r\n]$/.test(value)) continue;
    env[name] = value.replace(/[\r\n]+$/, "");
    trimmed.push(name);
  }
  return trimmed;
}

const trimmed = trimLineEnds(process.env);
if (trimmed.length > 0) log("WARNING", "env_trimmed", { variables: trimmed });
