/**
 * lib/theme.ts
 *
 * globals.css is the ONLY place colors are authored. This file never
 * hardcodes a color value as the source of truth — it resolves whatever
 * is currently set on :root at call time and hands Three.js (which can't
 * read CSS custom properties) numeric hex equivalents.
 *
 * Change a value in app/globals.css and both the DOM-rendered UI and the
 * WebGL globe update together, automatically, with nothing to keep in
 * sync by hand.
 *
 * The fallback hex table below exists only for the (rare) case a variable
 * read fails — e.g. this module were ever imported somewhere without a
 * document. It intentionally mirrors globals.css but is NOT what callers
 * should rely on; it is a safety net, not a second source of truth.
 */

const FALLBACK: Record<string, number> = {
  "--bg": 0x09090b,
  "--surface": 0x101013,
  "--surface-2": 0x17171b,
  "--border": 0x232327,
  "--border-strong": 0x35353b,
  "--text-primary": 0xf4f4f5,
  "--text-secondary": 0x9b9da6,
  "--text-tertiary": 0x6c6e77,
  "--accent": 0xe7e8ea,
  "--accent-dim": 0x8a8b90,
  "--critical": 0xf0453d,
  "--high": 0xf0913d,
  "--medium": 0xd9aa3c,
  "--low": 0x5b84a6,
  "--safe": 0x3fbe79,
};

/**
 * Resolves any valid CSS color string (hex, rgb, rgba, named) to a
 * 0xRRGGBB number by delegating to the browser's own CSS color parser
 * rather than hand-rolling one — this handles every format the
 * variables in globals.css could ever be written in without extra code.
 */
function parseCssColorToHex(raw: string): number | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("div");
  probe.style.color = raw;
  // Must be attached to compute a resolved rgb() value.
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);

  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  return (r << 16) | (g << 8) | b;
}

/** Reads a custom property off :root and returns it as a 0xRRGGBB number. */
export function cssVarToHex(varName: string): number {
  const fallback = FALLBACK[varName] ?? 0xe7e8ea;
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    return parseCssColorToHex(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export interface GlobeTheme {
  accent: number;
  bg: number;
  textPrimary: number;
  textSecondary: number;
  severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    safe: number;
  };
}

/**
 * Snapshot of every color Globe3D needs, resolved live from :root.
 * Call this once per scene build (Globe3D already runs this inside a
 * client-only useEffect, so document/window are always available there).
 */
export function getGlobeTheme(): GlobeTheme {
  return {
    accent: cssVarToHex("--accent"),
    bg: cssVarToHex("--bg"),
    textPrimary: cssVarToHex("--text-primary"),
    textSecondary: cssVarToHex("--text-secondary"),
    severity: {
      critical: cssVarToHex("--critical"),
      high: cssVarToHex("--high"),
      medium: cssVarToHex("--medium"),
      low: cssVarToHex("--low"),
      safe: cssVarToHex("--safe"),
    },
  };
}

/**
 * lib/format.ts's severityColor() returns strings like "var(--critical)"
 * for use directly in CSS. This maps that same string to the resolved
 * numeric value on a given GlobeTheme snapshot, so Globe3D and the 2D UI
 * are guaranteed to agree on which severity maps to which color — only
 * the var-name-to-field correspondence is structural, never the color
 * value itself.
 */
export function severityHexFromVar(varString: string, theme: GlobeTheme): number {
  switch (varString) {
    case "var(--critical)":
      return theme.severity.critical;
    case "var(--high)":
      return theme.severity.high;
    case "var(--medium)":
      return theme.severity.medium;
    case "var(--low)":
      return theme.severity.low;
    default:
      return theme.accent;
  }
}