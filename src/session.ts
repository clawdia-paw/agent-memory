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
   * Generate a startup context block with a strict token budget.
   * 
   * The budget system works like this:
   * 1. Reserve space for each section (identity, pinned, recent, entities, stats)
   * 2. Fill sections in priority order, stopping when budget is exhausted
   * 3. Each memory line is ~30 tokens. We estimate rather than count exactly.
   * 
   * Default budget: 800 tokens (~3.2KB). Configurable via maxTokens.
   */
  async getStartupContext(maxTokens: number = 800): Promise<string> {
    const TOKENS_PER_LINE = 35; // Conservative estimate for a memory line
    let budgetRemaining = maxTokens;
    const sections: string[] = [];

    const addLine = (line: string): boolean => {
      const cost = Math.ceil(line.length / 3.2); // ~3.2 chars per token (conservative)
      if (cost > budgetRemaining) return false;
      sections.push(line);
      budgetRemaining -= cost;
      return true;
    };

    // 1. Identity (always included, ~3 lines, ~50 tokens)
    const allMemories = this.store.getAllMemories(500);
    const pinned = allMemories.filter(m => m.pinned);
    const identityPinned = pinned.filter(m => 
      m.content.toLowerCase().includes('name:') || 
      m.content.toLowerCase().includes('born:') || 
      m.content.toLowerCase().includes('human:')
    );
    
    addLine('## Identity');
    for (const m of identityPinned.slice(0, 3)) {
      if (!addLine(`- ${m.content.slice(0, 80)}`)) break;
    }

    // 2. Pinned procedures & lessons (highest value — these prevent mistakes)
    // Sort by access count (most-used first) then by confidence
    const procedurePins = pinned
      .filter(m => !identityPinned.includes(m))
      .sort((a, b) => (b.accessCount - a.accessCount) || (b.confidence.score - a.confidence.score));

    if (procedurePins.length > 0) {
      addLine('\n## Core (Pinned)');
      for (const m of procedurePins) {
        const src = m.attribution.type + (m.attribution.actor ? `/${m.attribution.actor}` : '');
        if (!addLine(`- [${Math.round(m.confidence.score * 100)}% ${src}] ${m.summary ?? m.content.slice(0, 100)}`)) break;
      }
    }

    // 3. Entity summary (compact, cheap — before recent which eats budget)
    const entities = this.store.getAllEntities()
      .filter(e => e.memoryCount > 0)
      .sort((a, b) => b.memoryCount - a.memoryCount);

    if (entities.length > 0 && budgetRemaining > 60) {
      addLine('\n## Entities');
      const entityList = entities.slice(0, 8)
        .map(e => `${e.name}(${e.memoryCount})`)
        .join(', ');
      addLine(entityList);
    }

    // 4. Recent high-value memories (last 48h, deduplicated against pinned)
    const recentCutoff = Date.now() - 48 * 60 * 60 * 1000;
    const pinnedIds = new Set(pinned.map(m => m.id));
    const recent = allMemories
      .filter(m => 
        m.created > recentCutoff && 
        m.confidence.score >= 0.5 && 
        !pinnedIds.has(m.id) &&
        (m.content.length > 20) && // Filter out section headers and tiny entries
        !m.content.match(/^(#{1,4}\s|Key |What |Services |Other)/) // Skip markdown headers imported as memories
      )
      .sort((a, b) => {
        // Rank by: (entities > 0 ? bonus) × confidence × recency
        const entityBonus = (e: typeof a) => e.entities.length > 0 ? 1.3 : 1.0;
        const scoreA = entityBonus(a) * a.confidence.score * (1 + (a.created - recentCutoff) / (48 * 60 * 60 * 1000));
        const scoreB = entityBonus(b) * b.confidence.score * (1 + (b.created - recentCutoff) / (48 * 60 * 60 * 1000));
        return scoreB - scoreA;
      });

    if (recent.length > 0 && budgetRemaining > 100) {
      addLine('\n## Recent');
      for (const m of recent) {
        const src = m.attribution.type + (m.attribution.actor ? `/${m.attribution.actor}` : '');
        if (!addLine(`- [${Math.round(m.confidence.score * 100)}% ${src}] ${m.summary ?? m.content.slice(0, 100)}`)) break;
      }
    }

    // 5. Stats (one line)
    const stats = this.store.getStats();
    if (budgetRemaining > 20) {
      addLine(`\n📊 ${stats.memories} memories, ${stats.entities} entities, avg confidence ${stats.avgConfidence}`);
    }

    // 6. Budget info
    const usedTokens = maxTokens - budgetRemaining;
    addLine(`[${usedTokens}/${maxTokens} tokens used]`);

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
