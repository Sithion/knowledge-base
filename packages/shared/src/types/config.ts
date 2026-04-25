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
}

export interface SDKConfig {
  database: DatabaseConfig;
  ollama: OllamaConfig;
  aiStack: AiStackConfig;
}
