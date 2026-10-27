import type { AgentPhase } from "@/hooks/agent/useAgentSession";

/** The i18n translate function shape this module needs. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The status line shown while the agent is working.
 *
 * `isCompacting` takes precedence over the phase: auto-compaction can hold a turn for a
 * while before the next token arrives, and reporting the underlying "waiting for model"
 * phase in the meantime reads as a hang. Compaction is what the user needs to know.
 */
export function phaseLabel(phase: AgentPhase, t: Translate, isCompacting?: boolean): string | null {
  if (isCompacting) return "Compacting…";
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${`Running ${latest.name}...`} ${latest.progress}`;
    }
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  if (phase?.kind === "running_command") return "Running command...";
  return null;
}
