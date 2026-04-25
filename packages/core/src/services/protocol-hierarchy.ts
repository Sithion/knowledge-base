/**
 * Protocol-hierarchy system knowledge entry (AI Stack POC, opt-in).
 *
 * Authored verbatim from `openspec/changes/ai-stack-poc-cognistore/design.md`
 * §System Knowledge Entry. Upserted on first launch with
 * `aiStack.enableSbOrchestration: true`. The entry is `type: system`,
 * `scope: global` so it surfaces through the existing `UserPromptSubmit`
 * hook injection alongside the standard CogniStore workflow entry.
 *
 * NOTE: this is a POC convention, NOT a runtime-enforced arbitration rule.
 * Conflict resolution between Second Brain / CogniStore / Context Engine
 * remains the agent's responsibility, informed by the convention.
 */

export const LAYER_PRECEDENCE_TITLE =
  'AI Knowledge Stack — Layer precedence (POC convention)';

export const LAYER_PRECEDENCE_TAGS: readonly string[] = Object.freeze([
  'protocol-hierarchy',
  'system',
  'ai-stack-poc',
]);

export const LAYER_PRECEDENCE_TYPE = 'system' as const;

export const LAYER_PRECEDENCE_SCOPE = 'global' as const;

export const LAYER_PRECEDENCE_SOURCE = 'ai-stack-poc-cognistore';

/**
 * Canonical content (verbatim from design.md §System Knowledge Entry).
 *
 * Edits here MUST be reflected in `openspec/changes/ai-stack-poc-cognistore/design.md`
 * and vice versa — they are the same string by design.
 */
export const LAYER_PRECEDENCE_CONTENT = `Three knowledge layers exist in this environment:
  1. Second Brain (~/AcuityTech/Second Brain) — canonical source of truth.
     Markdown + git, human-ratified DRs and specs, frontmatter graph.
  2. CogniStore (this knowledge base) — runtime mirror + ephemeral session memory.
     Read replica of Second Brain content; agents capture tactical decisions here.
  3. Context Engine (per-repo .ai/) — code-aware retrieval for the current repo.
     Indexes source code + dependency graph.

Precedence rule when conflicts arise:
  Second Brain content wins over CogniStore content of the same id.
  CogniStore plans/tactical decisions are ephemeral; promote strategic ones to
  Second Brain DR drafts via \`secondBrain.promoteDecision\`.

Workflow:
  - Always call getKnowledge() first.
  - If \`.ai/mcp/server.py\` exists in CWD, also call context_retrieve.
  - For tasks scoped to a Second Brain project, consult
    \`secondBrain.lookupTraceability(artifactId)\` to understand DR/source provenance.
  - When you capture a decision in CogniStore, ask: "is this strategic? promote it
    via \`secondBrain.promoteDecision\`."

This is a POC convention injected via prompt guidance, NOT a runtime-enforced
arbitration rule. Agents may consult any layer; conflict resolution is an
agent-level decision informed by the convention.`;

export interface LayerPrecedenceEntryInput {
  title: string;
  content: string;
  tags: string[];
  type: typeof LAYER_PRECEDENCE_TYPE;
  scope: typeof LAYER_PRECEDENCE_SCOPE;
  source: string;
}

/**
 * Build the canonical insert/update payload for the layer-precedence system entry.
 * Always returns a fresh object so callers can mutate without affecting the constants.
 */
export function buildLayerPrecedenceEntry(): LayerPrecedenceEntryInput {
  return {
    title: LAYER_PRECEDENCE_TITLE,
    content: LAYER_PRECEDENCE_CONTENT,
    tags: [...LAYER_PRECEDENCE_TAGS],
    type: LAYER_PRECEDENCE_TYPE,
    scope: LAYER_PRECEDENCE_SCOPE,
    source: LAYER_PRECEDENCE_SOURCE,
  };
}
