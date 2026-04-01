import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  OLLAMA_NATIVE_DIMENSIONS,
} from '@cognistore/shared';
import type { EmbeddingRequest, EmbeddingResponse, OllamaTagsResponse } from './types.js';

export interface OllamaClientConfig {
  host?: string;
  model?: string;
  dimensions?: number;
  maxRetries?: number;
  maxInputChars?: number;
}

export class OllamaEmbeddingClient {
  private host: string;
  private model: string;
  private dimensions: number;
  private maxRetries: number;
  private maxInputChars: number;

  constructor(config?: OllamaClientConfig) {
    this.host = config?.host ?? (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST);
    this.model = config?.model ?? (process.env.OLLAMA_MODEL ?? DEFAULT_EMBEDDING_MODEL);
    this.dimensions = config?.dimensions ?? (Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS);
    this.maxRetries = config?.maxRetries ?? 3;
    this.maxInputChars = config?.maxInputChars ?? 2000;
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > maxChars * 0.5 ? truncated.slice(0, lastSpace) : truncated;
  }

  async embed(text: string): Promise<number[]> {
    const body: EmbeddingRequest = {
      model: this.model,
      prompt: this.truncateText(text, this.maxInputChars),
      options: { num_ctx: 8192 },
    };

    const response = await this.fetchWithRetry(`${this.host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as EmbeddingResponse;

    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Invalid embedding response from Ollama');
    }

    // nomic-embed-text returns 768 dims natively; we truncate via Matryoshka (MRL)
    if (data.embedding.length < this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected at least ${this.dimensions}, got ${data.embedding.length}. ` +
        `Check that OLLAMA_MODEL and EMBEDDING_DIMENSIONS are compatible.`
      );
    }

    // Matryoshka truncation: first N dims are a valid lower-dimensional embedding
    if (data.embedding.length > this.dimensions) {
      return this.truncateAndNormalize(data.embedding, this.dimensions);
    }

    return data.embedding;
  }

  async embedBatch(texts: string[], concurrency = 3): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(text => this.embed(text)));
      results.push(...batchResults);
    }

    return results;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async isModelAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) return false;

      const data = (await response.json()) as OllamaTagsResponse;
      return data.models.some(m => m.name === this.model || m.name.startsWith(`${this.model}:`));
    } catch {
      return false;
    }
  }

  async pullModel(): Promise<void> {
    const response = await fetch(`${this.host}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.model }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model ${this.model}: ${response.statusText}`);
    }

    // Consume the stream to completion
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
  }

  async ensureModel(): Promise<void> {
    const available = await this.isModelAvailable();
    if (!available) {
      await this.pullModel();
    }
  }

  getConfig() {
    return {
      host: this.host,
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  /**
   * Matryoshka truncation: slice to first targetDims dimensions, then L2-normalize.
   * L2 normalization is critical for cosine similarity quality after truncation.
   */
  private truncateAndNormalize(embedding: number[], targetDims: number): number[] {
    const truncated = embedding.slice(0, targetDims);
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return truncated;
    return truncated.map(v => v / norm);
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fetch(url, init);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 500;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw new Error(`Failed after ${this.maxRetries} retries: ${lastError?.message}`);
  }
}
