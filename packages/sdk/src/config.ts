import {
  DEFAULT_SQLITE_PATH,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_ENABLE_SB_ORCHESTRATION,
  DEFAULT_CONTEXT_ENGINE_REPOS,
  type SDKConfig,
} from '@cognistore/shared';

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parseListEnv(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function resolveConfig(userConfig?: Partial<SDKConfig>): SDKConfig {
  return {
    database: {
      path: userConfig?.database?.path ?? (process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH),
    },
    ollama: {
      host: userConfig?.ollama?.host ?? (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST),
      model: userConfig?.ollama?.model ?? (process.env.OLLAMA_MODEL ?? DEFAULT_EMBEDDING_MODEL),
      dimensions: userConfig?.ollama?.dimensions ?? (Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS),
    },
    aiStack: {
      // TODO(ai-stack-poc): gate sb-orchestration code on this flag in wave 3.
      enableSbOrchestration:
        userConfig?.aiStack?.enableSbOrchestration ??
        parseBoolEnv(process.env.COGNISTORE_ENABLE_SB_ORCHESTRATION, DEFAULT_ENABLE_SB_ORCHESTRATION),
      secondBrainPath:
        userConfig?.aiStack?.secondBrainPath ?? (process.env.COGNISTORE_SECOND_BRAIN_PATH || undefined),
      contextEngineRepos:
        userConfig?.aiStack?.contextEngineRepos ??
        parseListEnv(process.env.COGNISTORE_CONTEXT_ENGINE_REPOS) ??
        [...DEFAULT_CONTEXT_ENGINE_REPOS],
    },
  };
}
