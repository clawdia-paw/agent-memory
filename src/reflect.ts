/**
 * Agent Memory — Reflect Module
 * 
 * Scheduled reflection operations that maintain memory health:
 * - Decay application (relevance fading over time)
 * - Confidence recalculation (corroboration, contradictions)
 * - Duplicate/overlap detection
 * - Entity page generation (summary of everything known about an entity)
 * - Memory health reporting
 * 
 * Think of this as the "sleeping brain" — consolidating, pruning,
 * strengthening connections.
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { Memory, Entity } from './types.js';

export interface ReflectionReport {
  timestamp: number;
  decayResults: { updated: number; archived: number };
  duplicatesFound: number;
  contradictionsFound: number;
  entitySummaries: number;
  healthScore: number; // 0-100
  issues: string[];
  suggestions: string[];
}

export class ReflectEngine {
  private store: MemoryStore;
  private recall: RecallEngine;

  constructor(store: MemoryStore, recall: RecallEngine) {
    this.store = store;
    this.recall = recall;
  }

  /**
   * Run a full reflection cycle. Call this periodically (e.g., during heartbeats).
   */
  async reflect(): Promise<ReflectionReport> {
    const report: ReflectionReport = {
      timestamp: Date.now(),
      decayResults: { updated: 0, archived: 0 },
      duplicatesFound: 0,
      contradictionsFound: 0,
      entitySummaries: 0,
      healthScore: 100,
      issues: [],
      suggestions: [],
    };

    // 1. Apply decay
    report.decayResults = this.store.applyDecay();
    if (report.decayResults.archived > 0) {
      report.suggestions.push(
        `${report.decayResults.archived} memories fell below 5% relevance. Consider reviewing or pinning important ones.`
      );
    }

    // 2. Find potential duplicates
    report.duplicatesFound = this.findDuplicates();
    if (report.duplicatesFound > 0) {
      report.issues.push(`Found ${report.duplicatesFound} potential duplicate memory pairs.`);
      report.healthScore -= report.duplicatesFound * 2;
    }

    // 3. Check for low-attribution memories
    const lowAttr = this.findLowAttributionMemories();
    if (lowAttr > 0) {
      report.issues.push(`${lowAttr} memories have weak or missing attribution context.`);
      report.suggestions.push('Consider enriching attribution on important memories.');
      report.healthScore -= lowAttr;
    }

    // 4. Generate entity summaries
    const entities = this.store.getAllEntities();
    for (const entity of entities) {
      if (entity.memoryCount > 0) {
        report.entitySummaries++;
      }
    }

    // 5. Check memory distribution health
    const stats = this.store.getStats();
    if (stats.avgConfidence < 0.4) {
      report.issues.push(`Average confidence is low (${stats.avgConfidence}). Many memories are uncertain.`);
      report.healthScore -= 10;
    }
    if (stats.memories > 0 && stats.entities === 0) {
      report.issues.push('No entities defined. Memories are unlinked.');
      report.healthScore -= 5;
    }

    report.healthScore = Math.max(0, Math.min(100, report.healthScore));
    return report;
  }

  /**
   * Generate a summary page for an entity — everything we know about them,
   * organized by category and ranked by confidence.
   */
  generateEntitySummary(entityId: string): string {
    const entity = this.store.getEntity(entityId);
    if (!entity) return `Entity not found: ${entityId}`;

    const memories = this.store.getEntityMemories(entityId, 50);
    if (memories.length === 0) return `No memories about ${entity.name}.`;

    // Group by category
    const byCategory = new Map<string, Memory[]>();
    for (const mem of memories) {
      const cat = mem.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(mem);
    }

    const lines: string[] = [
      `# ${entity.name}`,
      `Type: ${entity.type}${entity.description ? ` — ${entity.description}` : ''}`,
      `Memories: ${memories.length}`,
      '',
    ];

    for (const [category, mems] of byCategory) {
      lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}s`);
      
      // Sort by confidence within category
      mems.sort((a, b) => b.confidence.score - a.confidence.score);
      
      for (const mem of mems) {
        const conf = Math.round(mem.confidence.score * 100);
        const source = mem.attribution.type + (mem.attribution.actor ? ` (via ${mem.attribution.actor})` : '');
        lines.push(`- [${conf}%] ${mem.summary ?? mem.content.slice(0, 80)}`);
        lines.push(`  Source: ${source}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Find memories that might be duplicates or overlapping.
   * Uses simple text similarity for now — embeddings later.
   */
  private findDuplicates(): number {
    const memories = this.store.getAllMemories(200);
    let duplicates = 0;

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        if (this.textSimilarity(memories[i].content, memories[j].content) > 0.7) {
          duplicates++;
        }
      }
    }

    return duplicates;
  }

  /**
   * Find memories with weak attribution (no context, no actor for told/read types).
   */
  private findLowAttributionMemories(): number {
    const memories = this.store.getAllMemories(200);
    let count = 0;

    for (const mem of memories) {
      const attr = mem.attribution;
      // Told/read memories should have an actor
      if ((attr.type === 'told' || attr.type === 'read') && !attr.actor) {
        count++;
      }
      // All memories benefit from context
      if (!attr.context) {
        count++;
      }
    }

    return count;
  }

  /**
   * Simple Jaccard text similarity.
   */
  private textSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    
    let intersection = 0;
    for (const word of setA) {
      if (setB.has(word)) intersection++;
    }
    
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Format a reflection report for display.
   */
  static formatReport(report: ReflectionReport): string {
    const lines = [
      '🧠 Memory Reflection Report',
      `   Time: ${new Date(report.timestamp).toISOString()}`,
      `   Health Score: ${report.healthScore}/100`,
      '',
      `📉 Decay: ${report.decayResults.updated} updated, ${report.decayResults.archived} archived`,
      `🔍 Duplicates: ${report.duplicatesFound}`,
      `📊 Entity Summaries: ${report.entitySummaries}`,
    ];

    if (report.issues.length > 0) {
      lines.push('', '⚠️  Issues:');
      for (const issue of report.issues) {
        lines.push(`   - ${issue}`);
      }
    }

    if (report.suggestions.length > 0) {
      lines.push('', '💡 Suggestions:');
      for (const sug of report.suggestions) {
        lines.push(`   - ${sug}`);
      }
    }

    return lines.join('\n');
  }
}
