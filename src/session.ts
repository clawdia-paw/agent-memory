/**
 * Agent Memory — Session Integration
 * 
 * Hooks into session lifecycle:
 * - On startup: load core context from memory DB
 * - During session: store new memories as they happen  
 * - On shutdown/compaction: flush important context to memory
 * 
 * This replaces the "read MEMORY.md and hope for the best" approach.
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { GeminiEmbedder, CachedEmbedder } from './embeddings.js';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const HOME = process.env.HOME ?? '/home/clawdia';
const DB_PATH = process.env.AGENT_MEMORY_DB ?? resolve(HOME, '.agent-memory/memory.db');

export class SessionMemory {
  private store: MemoryStore;
  private recall: RecallEngine;

  constructor(dbPath?: string) {
    const path = dbPath ?? DB_PATH;
    mkdirSync(resolve(path, '..'), { recursive: true });
    this.store = new MemoryStore(path);
    
    let embedder;
    try {
      embedder = new CachedEmbedder(new GeminiEmbedder());
    } catch {
      // No API key — text-only search
    }
    this.recall = new RecallEngine(this.store, embedder);
  }

  /**
   * Generate a startup context block — the essential memories for beginning a session.
   * This replaces reading MEMORY.md.
   */
  async getStartupContext(): Promise<string> {
    const sections: string[] = [];

    // 1. Identity & core facts (pinned memories)
    const pinned = this.store.getAllMemories(200).filter(m => m.pinned);
    if (pinned.length > 0) {
      sections.push('## Core Memory (Pinned)');
      for (const m of pinned.slice(0, 20)) {
        const src = m.attribution.type + (m.attribution.actor ? `/${m.attribution.actor}` : '');
        sections.push(`- [${Math.round(m.confidence.score * 100)}% ${src}] ${m.summary ?? m.content.slice(0, 120)}`);
      }
    }

    // 2. Recent memories (last 48h, high confidence)
    const recentCutoff = Date.now() - 48 * 60 * 60 * 1000;
    const recent = this.store.getAllMemories(200)
      .filter(m => m.created > recentCutoff && m.confidence.score >= 0.5)
      .sort((a, b) => b.created - a.created)
      .slice(0, 15);
    
    if (recent.length > 0) {
      sections.push('\n## Recent (Last 48h)');
      for (const m of recent) {
        const src = m.attribution.type + (m.attribution.actor ? `/${m.attribution.actor}` : '');
        sections.push(`- [${Math.round(m.confidence.score * 100)}% ${src}] ${m.summary ?? m.content.slice(0, 120)}`);
      }
    }

    // 3. Key entities summary
    const entities = this.store.getAllEntities()
      .filter(e => e.memoryCount > 0)
      .sort((a, b) => b.memoryCount - a.memoryCount)
      .slice(0, 10);
    
    if (entities.length > 0) {
      sections.push('\n## Key Entities');
      for (const e of entities) {
        sections.push(`- **${e.name}** (${e.type}) — ${e.memoryCount} memories${e.description ? `. ${e.description}` : ''}`);
      }
    }

    // 4. Stats
    const stats = this.store.getStats();
    sections.push(`\n## Memory Stats`);
    sections.push(`Total: ${stats.memories} memories, ${stats.entities} entities | Avg confidence: ${stats.avgConfidence} | Avg relevance: ${stats.avgRelevance}`);

    return sections.join('\n');
  }

  /**
   * Context-aware recall for mid-session use.
   * Returns compact format suitable for injecting into agent context.
   */
  async query(text: string, limit: number = 5): Promise<string> {
    const results = await this.recall.recall({ text, limit });
    return this.recall.formatCompact(results);
  }

  /**
   * Quick store — create a memory from a simple description.
   * For use during conversations when you learn something.
   */
  remember(content: string, opts: {
    source: 'experienced' | 'told' | 'read' | 'inferred' | 'observed';
    actor?: string;
    context?: string;
    category?: string;
    entities?: string[];
    pinned?: boolean;
  }): string {
    const mem = this.store.createMemory({
      content,
      attribution: {
        type: opts.source,
        actor: opts.actor,
        context: opts.context,
      },
      category: (opts.category as any) ?? 'fact',
      entities: opts.entities,
      pinned: opts.pinned,
    });
    return `Stored [${mem.id.slice(0, 8)}] confidence: ${mem.confidence.score}`;
  }

  /**
   * End-of-session summary — what was learned this session.
   */
  getSessionSummary(since: number): string {
    const memories = this.store.getAllMemories(200)
      .filter(m => m.created >= since)
      .sort((a, b) => a.created - b.created);
    
    if (memories.length === 0) return 'No new memories this session.';

    const lines = [`Memories created this session: ${memories.length}\n`];
    for (const m of memories) {
      const src = m.attribution.type + (m.attribution.actor ? `/${m.attribution.actor}` : '');
      lines.push(`- [${Math.round(m.confidence.score * 100)}% ${src}] ${m.summary ?? m.content.slice(0, 80)}`);
    }
    return lines.join('\n');
  }

  close(): void {
    this.store.close();
  }
}
