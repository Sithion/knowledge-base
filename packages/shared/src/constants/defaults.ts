import { KnowledgeType } from '../types/knowledge.js';

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_EMBEDDING_DIMENSIONS = 256;
export const OLLAMA_NATIVE_DIMENSIONS = 768;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
export const DEFAULT_OLLAMA_PORT = 11434;
export const DEFAULT_SQLITE_PATH = '~/.cognistore/knowledge.db';

// AI Stack POC defaults (see `ai-stack-poc-cognistore` openspec change).
// All defaults are "off" so existing deployments see no behavior change.
// TODO(ai-stack-poc): gate sb-orchestration code on `enableSbOrchestration` in wave 3.
export const DEFAULT_ENABLE_SB_ORCHESTRATION = false;
export const DEFAULT_CONTEXT_ENGINE_REPOS: readonly string[] = Object.freeze([]);

export const KNOWLEDGE_TYPES = Object.values(KnowledgeType);
