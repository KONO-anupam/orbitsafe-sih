import { Confidence, Severity } from "./types";

export function severityColor(sev: Severity): string {
  switch (sev) {
    case "CRITICAL":
      return "var(--critical)";
    case "HIGH":
      return "var(--high)";
    case "MEDIUM":
      return "var(--medium)";
    case "LOW":
      return "var(--low)";
  }
}

export function severityGlow(sev: Severity): string {
  switch (sev) {
    case "CRITICAL":
      return "var(--critical-glow)";
    case "HIGH":
      return "var(--high-glow)";
    case "MEDIUM":
      return "var(--medium-glow)";
    case "LOW":
      return "var(--low-glow)";
  }
}

export function confidenceColor(c: Confidence): string {
  switch (c) {
    case "HIGH":
      return "var(--safe)";
    case "MEDIUM":
      return "var(--medium)";
    case "LOW":
      return "var(--critical)";
  }
}

export function timeUntil(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 0) return "elapsed";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatUTC(iso: string): string {
  const d = new Date(iso);
  return (
    d.toISOString().replace("T", " ").replace(".000Z", "Z")
  );
}

export function formatClock(d: Date): string {
  return d.toISOString().slice(11, 19) + " UTC";
}
