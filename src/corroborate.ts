/**
 * Agent Memory — Corroboration Engine
 * 
 * The key insight: confidence shouldn't be static. When multiple independent
 * sources agree on something, confidence should increase. When sources
 * contradict, both should be flagged.
 * 
 * This is what human memory does naturally (sort of) — repeated exposure
 * to consistent information strengthens the memory. We're making it explicit.
 */

import { MemoryStore } from './store.js';
import { Memory, Confidence } from './types.js';

export interface CorroborationResult {
  memoryId: string;
  oldConfidence: number;
  newConfidence: number;
  reason: string;
}

export interface ContradictionResult {
  memoryA: { id: string; summary: string; confidence: number };
  memoryB: { id: string; summary: string; confidence: number };
  similarity: number;
  reason: string;
}

export class CorroborationEngine {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * When a new memory is created, check existing memories for corroboration.
   * If we find memories that support the same claim from different sources,
   * boost confidence on both.
   */
  checkCorroboration(newMemory: Memory): CorroborationResult[] {
    const results: CorroborationResult[] = [];
    
    // Find related memories (same entities, similar content)
    const candidates = this.findRelated(newMemory);
    
    for (const existing of candidates) {
      // Skip self
      if (existing.id === newMemory.id) continue;
      
      // Check if they're from different sources (independent corroboration)
      if (this.isIndependentSource(newMemory, existing)) {
        const similarity = this.contentSimilarity(newMemory.content, existing.content);
        
        if (similarity > 0.5) {
          // They agree! Boost existing memory's confidence
          const boost = this.calculateBoost(similarity, newMemory, existing);
          const oldScore = existing.confidence.score;
          const newScore = Math.min(1, oldScore + boost);
          
          // Update in store
          this.updateConfidence(existing.id, {
            ...existing.confidence,
            score: Math.round(newScore * 100) / 100,
            corroborations: existing.confidence.corroborations + 1,
            lastVerified: Date.now(),
            basis: [
              ...existing.confidence.basis,
              `+${Math.round(boost * 100)}% corroborated by ${newMemory.attribution.type} source`
            ],
          });

          results.push({
            memoryId: existing.id,
            oldConfidence: oldScore,
            newConfidence: newScore,
            reason: `Corroborated by new ${newMemory.attribution.type} memory (similarity: ${Math.round(similarity * 100)}%)`,
          });
        }
      }
    }

    return results;
  }

  /**
   * Scan all memories for potential contradictions.
   * Two memories contradict if they're about the same topic but make
   * opposing claims.
   * 
   * This is hard to do perfectly without NLU, but we can catch some cases:
   * - Same entity + same category + low content similarity = possible divergence
   * - Explicit negation patterns
   */
  findContradictions(limit: number = 50): ContradictionResult[] {
    const contradictions: ContradictionResult[] = [];
    const memories = this.store.getAllMemories(200);

    for (let i = 0; i < memories.length && contradictions.length < limit; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i];
        const b = memories[j];

        // Must share at least one entity to be potentially contradictory
        const sharedEntities = a.entities.filter(e => b.entities.includes(e));
        if (sharedEntities.length === 0) continue;

        // Same category = more likely to be about the same thing
        if (a.category !== b.category) continue;

        // Check for contradiction patterns
        const contradiction = this.detectContradiction(a, b);
        if (contradiction) {
          contradictions.push({
            memoryA: { id: a.id, summary: a.summary ?? a.content.slice(0, 60), confidence: a.confidence.score },
            memoryB: { id: b.id, summary: b.summary ?? b.content.slice(0, 60), confidence: b.confidence.score },
            similarity: this.contentSimilarity(a.content, b.content),
            reason: contradiction,
          });

          // Mark contradictions on both
          this.updateConfidence(a.id, {
            ...a.confidence,
            contradictions: a.confidence.contradictions + 1,
            basis: [...a.confidence.basis, `⚠️ Potential contradiction with memory ${b.id.slice(0, 8)}`],
          });
          this.updateConfidence(b.id, {
            ...b.confidence,
            contradictions: b.confidence.contradictions + 1,
            basis: [...b.confidence.basis, `⚠️ Potential contradiction with memory ${a.id.slice(0, 8)}`],
          });
        }
      }
    }

    return contradictions;
  }

  /**
   * Verify a specific memory — search for supporting evidence.
   */
  verifyMemory(memoryId: string): { verified: boolean; evidence: string[]; newConfidence: number } {
    const memory = this.store.getMemory(memoryId);
    if (!memory) return { verified: false, evidence: ['Memory not found'], newConfidence: 0 };

    const related = this.findRelated(memory);
    const evidence: string[] = [];
    let corroborations = 0;

    for (const rel of related) {
      if (rel.id === memoryId) continue;
      const sim = this.contentSimilarity(memory.content, rel.content);
      if (sim > 0.4) {
        corroborations++;
        evidence.push(
          `Supported by ${rel.attribution.type} memory` +
          (rel.attribution.actor ? ` (via ${rel.attribution.actor})` : '') +
          ` — ${Math.round(sim * 100)}% similar`
        );
      }
    }

    // Recalculate confidence based on evidence
    let newConfidence = memory.confidence.score;
    if (corroborations > 0) {
      newConfidence = Math.min(1, newConfidence + corroborations * 0.05);
      this.updateConfidence(memoryId, {
        ...memory.confidence,
        score: Math.round(newConfidence * 100) / 100,
        corroborations: memory.confidence.corroborations + corroborations,
        lastVerified: Date.now(),
      });
    }

    return {
      verified: corroborations > 0,
      evidence: evidence.length > 0 ? evidence : ['No corroborating evidence found'],
      newConfidence: Math.round(newConfidence * 100) / 100,
    };
  }

  // === Internal ===

  private findRelated(memory: Memory): Memory[] {
    const candidates: Memory[] = [];

    // By entity overlap
    for (const entityId of memory.entities) {
      const entityMems = this.store.getEntityMemories(entityId, 20);
      for (const m of entityMems) {
        if (!candidates.find(c => c.id === m.id)) {
          candidates.push(m);
        }
      }
    }

    // By text search (first few significant words)
    const keywords = memory.content.split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 3)
      .join(' ');
    if (keywords) {
      const textMatches = this.store.searchByText(keywords, 10);
      for (const m of textMatches) {
        if (!candidates.find(c => c.id === m.id)) {
          candidates.push(m);
        }
      }
    }

    return candidates;
  }

  private isIndependentSource(a: Memory, b: Memory): boolean {
    // Different source types are independent
    if (a.attribution.type !== b.attribution.type) return true;
    // Same type but different actors are independent
    if (a.attribution.actor && b.attribution.actor && a.attribution.actor !== b.attribution.actor) return true;
    // Different contexts suggest independence
    if (a.attribution.context && b.attribution.context && a.attribution.context !== b.attribution.context) return true;
    return false;
  }

  private calculateBoost(similarity: number, newMem: Memory, existingMem: Memory): number {
    // Base boost from similarity
    let boost = similarity * 0.1; // Max 10% per corroboration

    // Higher-quality sources give bigger boosts
    const sourceWeights: Record<string, number> = {
      experienced: 1.5,
      observed: 1.2,
      told: 1.0,
      read: 0.8,
      inferred: 0.5,
    };
    boost *= sourceWeights[newMem.attribution.type] ?? 1.0;

    // Diminishing returns on corroboration
    const existing = existingMem.confidence.corroborations;
    if (existing > 0) {
      boost *= 1 / (1 + existing * 0.3);
    }

    return Math.round(boost * 100) / 100;
  }

  private detectContradiction(a: Memory, b: Memory): string | null {
    const aLower = a.content.toLowerCase();
    const bLower = b.content.toLowerCase();

    // Look for explicit negation patterns
    const negationPairs = [
      ['is', "isn't"], ['is', 'is not'],
      ['can', "can't"], ['can', 'cannot'],
      ['does', "doesn't"], ['does', 'does not'],
      ['should', "shouldn't"], ['should', 'should not'],
      ['works', "doesn't work"], ['working', 'not working'],
      ['true', 'false'], ['yes', 'no'],
      ['enabled', 'disabled'],
    ];

    for (const [pos, neg] of negationPairs) {
      if ((aLower.includes(pos) && bLower.includes(neg)) ||
          (aLower.includes(neg) && bLower.includes(pos))) {
        // Check they're actually about the same thing (share significant words)
        const sim = this.contentSimilarity(aLower, bLower);
        if (sim > 0.3) {
          return `Potential negation: "${pos}" vs "${neg}" in related memories`;
        }
      }
    }

    return null;
  }

  private contentSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private updateConfidence(memoryId: string, confidence: Confidence): void {
    // Direct DB update for confidence
    const db = (this.store as any).db;
    db.prepare('UPDATE memories SET confidence = ?, updated = ? WHERE id = ?')
      .run(JSON.stringify(confidence), Date.now(), memoryId);
  }

  /**
   * Format contradiction results for display.
   */
  static formatContradictions(results: ContradictionResult[]): string {
    if (results.length === 0) return 'No contradictions found. ✓';

    return results.map((r, i) => [
      `⚠️  Contradiction ${i + 1}:`,
      `   A: [${Math.round(r.memoryA.confidence * 100)}%] ${r.memoryA.summary}`,
      `   B: [${Math.round(r.memoryB.confidence * 100)}%] ${r.memoryB.summary}`,
      `   Similarity: ${Math.round(r.similarity * 100)}%`,
      `   Reason: ${r.reason}`,
    ].join('\n')).join('\n\n');
  }
}
