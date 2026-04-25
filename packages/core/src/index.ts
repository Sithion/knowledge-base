export { createDbClient, type Database, type SQLiteDatabase } from './db/index.js';
export { runMigrations } from './db/index.js';
export { knowledgeEntries, knowledgeTypeEnum } from './db/index.js';
export {
  createEmbeddingsTable,
  insertEmbedding,
  updateEmbedding,
  deleteEmbedding,
  searchKnn,
} from './db/index.js';
export { KnowledgeRepository } from './repositories/index.js';
export {
  KnowledgeService,
  type EmbeddingProvider,
  LAYER_PRECEDENCE_TITLE,
  LAYER_PRECEDENCE_CONTENT,
  LAYER_PRECEDENCE_TAGS,
  LAYER_PRECEDENCE_TYPE,
  LAYER_PRECEDENCE_SCOPE,
  LAYER_PRECEDENCE_SOURCE,
  buildLayerPrecedenceEntry,
  type LayerPrecedenceEntryInput,
} from './services/index.js';
