/**
 * Agent Memory — Recall Engine
 * 
 * Context-aware memory retrieval that combines:
 * - Semantic similarity (embeddings)
 * - Lexical matching (text search)
 * - Confidence weighting
 * - Relevance decay
 * - Entity filtering
 * 
 * The key insight: recall isn't just "find similar text."
 * It's "find the most TRUSTWORTHY and RELEVANT memories for THIS context."
 */

import { MemoryStore } from './store.js';
import { Memory, RecallQuery, RecallResult } from './types.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class RecallEngine {
  private store: MemoryStore;
  private embedder?: EmbeddingProvider;

  constructor(store: MemoryStore, embedder?: EmbeddingProvider) {
    this.store = store;
    this.embedder = embedder;
  }

  /**
   * The main recall pipeline:
   * 1. Gather candidates (text search + entity filter + semantic)
   * 2. Score each candidate (match × confidence × relevance)
   * 3. Rank and return top results with full metadata
   */
  async recall(query: RecallQuery): Promise<RecallResult[]> {
    const limit = query.limit ?? 10;
    const minConfidence = query.minConfidence ?? 0.3;
    const minRelevance = query.minRelevance ?? 0.1;

    // Step 1: Gather candidates from multiple sources
    const candidateMap = new Map<string, { memory: Memory; scores: { text: number; semantic: number; entity: number } }>();

    // Text search candidates
    const textResults = this.store.searchByText(query.text, limit * 3);
    for (const mem of textResults) {
      candidateMap.set(mem.id, {
        memory: mem,
        scores: { text: this.textMatchScore(query.text, mem), semantic: 0, entity: 0 },
      });
    }

    // Entity filter candidates
    if (query.entities?.length) {
      for (const entityId of query.entities) {
        const entityMems = this.store.getEntityMemories(entityId, limit * 2);
        for (const mem of entityMems) {
          if (!candidateMap.has(mem.id)) {
            candidateMap.set(mem.id, {
              memory: mem,
              scores: { text: 0, semantic: 0, entity: 0 },
            });
          }
          candidateMap.get(mem.id)!.scores.entity = 1.0;
        }
      }
    }

    // Category filter
    if (query.categories?.length) {
      for (const cat of query.categories) {
        const catMems = this.store.searchByCategory(cat, limit * 2);
        for (const mem of catMems) {
          if (!candidateMap.has(mem.id)) {
            candidateMap.set(mem.id, {
              memory: mem,
              scores: { text: 0, semantic: 0, entity: 0 },
            });
          }
        }
      }
    }

    // Semantic search (if embedder available)
    if (this.embedder) {
      const queryEmbedding = await this.embedder.embed(query.text);
      
      // Also search ALL embeddings for semantic matches not found by text
      const allEmbeddings = this.store.getAllEmbeddings();
      for (const { id, embedding } of allEmbeddings) {
        const sim = cosineSimilarity(queryEmbedding, embedding);
        if (sim > 0.5) { // Minimum semantic similarity threshold (0.5 filters noise)
          if (!candidateMap.has(id)) {
            const mem = this.store.getMemory(id);
            if (mem) {
              candidateMap.set(id, {
                memory: mem,
                scores: { text: 0, semantic: sim, entity: 0 },
              });
            }
          } else {
            candidateMap.get(id)!.scores.semantic = sim;
          }
        }
      }
    }

    // Step 2: Score and filter
    const results: RecallResult[] = [];

    for (const [id, candidate] of candidateMap) {
      const { memory, scores } = candidate;

      // Apply filters
      if (memory.confidence.score < minConfidence) continue;
      if (memory.relevanceScore < minRelevance && !query.includeDecayed) continue;

      // Compute match score: weighted combination of search signals
      const matchScore = this.computeMatchScore(scores);

      // Final score: match × confidence × relevance
      const finalScore = matchScore * memory.confidence.score * memory.relevanceScore;

      // Context boost: if query has context, boost memories from similar contexts
      const contextBoost = query.context ? this.contextBoost(query.context, memory) : 1.0;

      results.push({
        memory,
        matchScore,
        finalScore: finalScore * contextBoost,
      });
    }

    // Step 3: Filter weak results, rank, and return
    const minFinalScore = 0.15; // Below this, the result is noise
    const filtered = results.filter(r => r.finalScore >= minFinalScore);
    filtered.sort((a, b) => b.finalScore - a.finalScore);
    return filtered.slice(0, limit);
  }

  /**
   * Quick recall — simpler version for when you just need a fast answer.
   * Text search only, no embeddings, still applies confidence/relevance weighting.
   */
  quickRecall(text: string, limit: number = 5): RecallResult[] {
    const memories = this.store.searchByText(text, limit * 3);
    
    const results: RecallResult[] = memories.map(memory => {
      const matchScore = this.textMatchScore(text, memory);
      return {
        memory,
        matchScore,
        finalScore: matchScore * memory.confidence.score * memory.relevanceScore,
      };
    });

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, limit);
  }

  /**
   * Entity recall — get everything about a specific entity, ranked.
   */
  entityRecall(entityId: string, limit: number = 20): RecallResult[] {
    const memories = this.store.getEntityMemories(entityId, limit);
    
    return memories.map(memory => ({
      memory,
      matchScore: 1.0, // Direct entity match
      finalScore: memory.confidence.score * memory.relevanceScore,
    })).sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Format recall results for display — shows attribution inline.
   * This is what makes our system different: you always see HOW you know something.
   */
  formatResults(results: RecallResult[]): string {
    if (results.length === 0) return 'No memories found.';

    return results.map((r, i) => {
      const m = r.memory;
      const attr = m.attribution;
      const conf = m.confidence;

      let source = attr.type;
      if (attr.actor) source += ` (via ${attr.actor})`;
      if (attr.context) source += ` — ${attr.context}`;

      const confidenceBar = '█'.repeat(Math.round(conf.score * 10)) + '░'.repeat(10 - Math.round(conf.score * 10));

      return [
        `${i + 1}. ${m.summary ?? m.content.slice(0, 80)}`,
        `   Source: ${source}`,
        `   Confidence: [${confidenceBar}] ${(conf.score * 100).toFixed(0)}%`,
        `   Category: ${m.category} | Entities: ${m.entities.join(', ') || 'none'}`,
        m.pinned ? '   📌 Pinned (no decay)' : `   Relevance: ${(m.relevanceScore * 100).toFixed(0)}%`,
      ].join('\n');
    }).join('\n\n');
  }

  // === Internal Scoring ===

  private textMatchScore(query: string, memory: Memory): number {
    const queryLower = query.toLowerCase();
    const contentLower = memory.content.toLowerCase();
    const summaryLower = (memory.summary ?? '').toLowerCase();
    
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    if (queryTerms.length === 0) return 0;

    let matches = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term)) matches++;
      if (summaryLower.includes(term)) matches += 0.5;
    }

    // Exact phrase bonus
    if (contentLower.includes(queryLower)) matches += queryTerms.length;

    return Math.min(1, matches / (queryTerms.length * 2));
  }

  private computeMatchScore(scores: { text: number; semantic: number; entity: number }): number {
    // Weighted combination — semantic gets highest weight when available
    if (scores.semantic > 0) {
      return scores.semantic * 0.5 + scores.text * 0.3 + scores.entity * 0.2;
    }
    // Without embeddings, text and entity split
    return scores.text * 0.7 + scores.entity * 0.3;
  }

  private contextBoost(context: string, memory: Memory): number {
    // Simple context matching — boost memories from similar contexts
    const contextLower = context.toLowerCase();
    const memContext = (memory.attribution.context ?? '').toLowerCase();
    
    if (!memContext) return 1.0;

    const contextTerms = contextLower.split(/\s+/).filter(t => t.length > 3);
    let overlap = 0;
    for (const term of contextTerms) {
      if (memContext.includes(term)) overlap++;
    }

    return 1.0 + (overlap / Math.max(contextTerms.length, 1)) * 0.3; // Up to 30% boost
  }
}

// === Utilities ===

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
