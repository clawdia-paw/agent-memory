/**
 * Agent Memory — Embedding Providers
 * 
 * Pluggable embedding backends for semantic search.
 * Currently supports Gemini (free tier, good quality).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { EmbeddingProvider } from './recall.js';

export class GeminiEmbedder implements EmbeddingProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey?: string, model: string = 'text-embedding-004') {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY required for Gemini embeddings');
    this.client = new GoogleGenerativeAI(key);
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const results: number[][] = [];
    
    // Gemini doesn't have a native batch embed, so we chunk manually
    // Rate limit: ~1500 RPM on free tier, so we're fine
    const CHUNK_SIZE = 10;
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      const chunk = texts.slice(i, i + CHUNK_SIZE);
      const promises = chunk.map(t => this.embed(t));
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
      
      // Small delay between chunks to be nice to the API
      if (i + CHUNK_SIZE < texts.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return results;
  }
}

/**
 * Simple in-memory cache for embeddings to avoid redundant API calls.
 */
export class CachedEmbedder implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private cache: Map<string, number[]> = new Map();

  constructor(inner: EmbeddingProvider) {
    this.inner = inner;
  }

  async embed(text: string): Promise<number[]> {
    const key = text.trim().toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    
    const embedding = await this.inner.embed(text);
    this.cache.set(key, embedding);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = texts[i].trim().toLowerCase();
      if (this.cache.has(key)) {
        results[i] = this.cache.get(key)!;
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    if (uncached.length > 0) {
      const newEmbeddings = await this.inner.embedBatch(uncached.map(u => u.text));
      for (let i = 0; i < uncached.length; i++) {
        const key = uncached[i].text.trim().toLowerCase();
        this.cache.set(key, newEmbeddings[i]);
        results[uncached[i].index] = newEmbeddings[i];
      }
    }

    return results;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
