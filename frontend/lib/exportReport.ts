/**
 * lib/exportReport.ts
 *
 * Builds a plain-text/markdown case file for one conjunction event, using
 * only data already present on the client (event, its evolution vs the
 * previous run, if any). No backend call, no new dependency — triggers a
 * browser download via a Blob + object URL.
 */

import { ConjunctionEvent } from "./types";
import { EventEvolution } from "./eventEvolution";
import { formatUTC } from "./format";

function section(title: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `## ${title}\n\n${lines.join("\n")}\n`;
}

export function buildReportMarkdown(event: ConjunctionEvent, evolution?: EventEvolution): string {
  const generatedAt = new Date().toISOString();

  const identity = section("Event identity", [
    `- Primary: ${event.primary.name} (NORAD ${event.primary.norad_id}, ${event.primary.object_type})`,
    `- Secondary: ${event.secondary.name} (NORAD ${event.secondary.norad_id}, ${event.secondary.object_type})`,
    `- Event ID: ${event.event_id}`,
    `- Time of closest approach (TCA): ${formatUTC(event.tca)}`,
  ]);

  const geometry = section("Geometry", [
    `- Miss distance: ${event.miss_distance_km.toFixed(2)} km`,
    `- Relative velocity: ${event.relative_velocity_km_s.toFixed(2)} km/s`,
    `- Forecast horizon: ${event.forecast_horizon_hours} h`,
  ]);

  const provenance = section("Data provenance", [
    `- Source: ${event.source}`,
    `- Method: ${event.method}`,
    `- Data age: ${event.data_age_hours.toFixed(1)} h`,
    `- Confidence: ${event.confidence}`,
  ]);

  const priority = section("Priority", [
    `- Risk score: ${event.risk_score}/100 (${event.severity})`,
    ...(event.mission_priority !== undefined && event.mission_priority !== event.risk_score
      ? [`- Mission-weighted priority: ${event.mission_priority}/100`]
      : []),
    ...(event.next_step ? [`- Next step: ${event.next_step}${event.next_step_reason ? ` — ${event.next_step_reason}` : ""}`] : []),
  ]);

  const breakdown = section(
    "Score breakdown",
    (event.score_breakdown ?? []).map((row) => `- ${row.label}: ${row.value}`)
  );

  const robustness = section(
    "Robustness",
    event.robustness_stable === undefined
      ? []
      : [
          `- Stable: ${event.robustness_stable ? "yes" : "no"}`,
          `- Max TCA difference under perturbation: ${(event.robustness_max_tca_diff_seconds ?? 0).toFixed(1)} s`,
          `- Max miss-distance difference under perturbation: ${(event.robustness_max_miss_distance_diff_km ?? 0).toFixed(2)} km`,
        ]
  );

  const evolutionLines: string[] = [];
  if (evolution) {
    evolutionLines.push(`- Status vs previous run: ${evolution.status}`);
    if (evolution.previous) {
      evolutionLines.push(`- Priority change: ${evolution.previous.risk_score} -> ${evolution.current.risk_score}`);
      for (const delta of evolution.deltas) {
        evolutionLines.push(`- ${delta.label}: ${delta.from} -> ${delta.to}`);
      }
      if (evolution.primaryDriver) {
        evolutionLines.push(`- Primary driver of change: ${evolution.primaryDriver.label}`);
      }
    }
  }
  const evolutionSection = section("Evolution since last run", evolutionLines);

  const limitations = section(
    "Limitations",
    event.limitations.map((l) => `- ${l}`)
  );

  return [
    `# ORBITSAFE Investigation Report`,
    ``,
    `Generated: ${generatedAt}`,
    `This is a nominal SGP4/GP screening assessment, not an operational flight-safety determination.`,
    ``,
    identity,
    geometry,
    provenance,
    priority,
    breakdown,
    robustness,
    evolutionSection,
    limitations,
  ]
    .filter(Boolean)
    .join("\n");
}

export function downloadReport(event: ConjunctionEvent, evolution?: EventEvolution): void {
  const markdown = buildReportMarkdown(event, evolution);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `orbitsafe-${event.primary.norad_id}-${event.secondary.norad_id}-${Date.now()}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
