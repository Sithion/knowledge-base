export interface DatabaseConfig {
  path: string;
}

export interface OllamaConfig {
  host: string;
  model: string;
  dimensions: number;
}

/**
 * AI Stack POC configuration (opt-in, see `ai-stack-poc-cognistore` openspec change).
 *
 * All fields default to "off" so existing CogniStore deployments without a
 * Second Brain checkout see no behavior change. Code paths that depend on these
 * fields MUST gate on `enableSbOrchestration` until the POC graduates.
 */
export interface AiStackConfig {
  /**
   * Filesystem path to a local Second Brain checkout. When unset, SB-orchestration
   * MCP tools fail-soft with a structured error rather than throwing.
   * Recommended default for users opting in: `~/AcuityTech/Second Brain`.
   */
  secondBrainPath?: string;

  /**
   * List of repository paths that have a Context Engine `.ai/` scaffold and
   * should be surfaced in the dashboard's Context Engine panel.
   */
  contextEngineRepos?: string[];

  /**
   * Master opt-in flag for the AI Knowledge Stack integration (Phase 1).
   * When `false` (default), no SB orchestration code paths run, the
   * layer-precedence system entry is not seeded, and the `UserPromptSubmit`
   * hook injects only the existing protocol text.
   */
  enableSbOrchestration: boolean;

  /**
   * Git remote URL for the Second Brain repository. Used by the intake
   * pipeline to bootstrap the **managed** clone at `${appDataDir}/second-brain-workspace/`
   * (distinct from the user's personal checkout at `secondBrainPath`).
   *
   * Required for first-run setup of the intake pipeline; intake actions
   * fail-soft with a clear error when unset. Plain `git clone` is used so
   * `gh auth` is only needed at PR-cut time, not at clone time.
   *
   * Example: `https://github.com/your-org/second-brain.git`
   */
  secondBrainRemote?: string;

  /**
   * Intake-pipeline configuration. Controls Phase A (Intake & Analysis)
   * and Phase B (PR Cut) Copilot CLI invocations.
   *
   * See `openspec/changes/ai-stack-poc-cognistore-intake-pipeline/`.
   * All fields are no-ops when `enableSbOrchestration` is `false`.
   */
  intakePipeline?: IntakePipelineConfig;
}

/**
 * Intake-pipeline tunables. All fields optional with sensible defaults;
 * the Rust bridge applies defaults via serde when fields are omitted.
 */
export interface IntakePipelineConfig {
  /**
   * Model id passed to `copilot --model` for Phase A (Intake & Analysis).
   * Default `auto` lets the bridge pick from the curated catalog
   * (typically a premium reasoning model).
   */
  intakeModel?: string;

  /**
   * Model id for Phase B (PR Cut) — typically cheaper because the agent
   * only needs to push the branch and open a draft PR.
   * Default `auto` (resolves to a fast/cheap tier).
   */
  prCutModel?: string;

  /**
   * Hard timeout for Phase A in seconds. On expiry the bridge sends
   * SIGTERM, then SIGKILL after the standard 5s grace period.
   * Default 1800 (30 minutes) — intake runs can be long.
   */
  intakeTimeoutSeconds?: number;

  /**
   * Hard timeout for Phase B in seconds.
   * Default 600 (10 minutes) — PR cut should be quick.
   */
  prCutTimeoutSeconds?: number;

  /**
   * Override directory for the managed Second Brain clone. When unset,
   * resolves to `${appDataDir}/second-brain-workspace/` per OS conventions.
   */
  workspaceDir?: string;

  /**
   * Base branch for `gh pr create --base` in Phase B. Default `develop`.
   * Test setups can target a throwaway branch (e.g. `test/intake-poc-base`).
   */
  prCutBaseBranch?: string;
}

export interface SDKConfig {
  database: DatabaseConfig;
  ollama: OllamaConfig;
  aiStack: AiStackConfig;
}
