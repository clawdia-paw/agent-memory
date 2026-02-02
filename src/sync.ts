/**
 * Agent Memory — Sync Engine (Bridge Mode)
 *
 * Indexes flat markdown files into the memory DB as a read layer.
 * The flat files remain source of truth. This extracts atomic facts
 * with proper attribution, not bulk line-by-line import.
 *
 * Design principles (from lessons-learned):
 * - Quality > quantity — skip noise, extract meaningful facts
 * - Attribution tracks HOW something was learned
 * - Manual memories (`mem add`) are never touched by sync
 * - Re-sync is idempotent — changed files get re-indexed
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { createHash } from 'crypto';
import { MemoryStore } from './store.js';
import { CreateMemoryInput, SourceType, MemoryCategory } from './types.js';

export interface SyncStats {
  filesScanned: number;
  filesChanged: number;
  factsExtracted: number;
  factsSkipped: number;
  oldFactsRemoved: number;
}

export interface ExtractedFact {
  content: string;
  section: string;
  sourceFile: string;
  sourceType: SourceType;
  category: MemoryCategory;
  entities: string[];
  tags: string[];
  pinned: boolean;
}

/**
 * A meaningful chunk extracted from a markdown file.
 * Not every line — grouped, filtered, and classified.
 */
interface Section {
  heading: string;
  headingLevel: number;
  items: string[];
}

export class SyncEngine {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
    this.ensureSyncTable();
  }

  private ensureSyncTable(): void {
    (this.store as any).db.exec(`
      CREATE TABLE IF NOT EXISTS synced_files (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        last_synced INTEGER NOT NULL,
        facts_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS synced_memories (
        memory_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        PRIMARY KEY (memory_id, file_path),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_synced_memories_file ON synced_memories(file_path);
    `);
  }

  /**
   * Sync workspace files into the memory DB.
   * Only processes files that have changed since last sync.
   */
  sync(workspacePath: string, opts?: { force?: boolean }): SyncStats {
    const stats: SyncStats = {
      filesScanned: 0,
      filesChanged: 0,
      factsExtracted: 0,
      factsSkipped: 0,
      oldFactsRemoved: 0,
    };

    // Collect target files
    const files = this.collectFiles(workspacePath);
    stats.filesScanned = files.length;

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      // Check if file changed
      if (!opts?.force) {
        const existing = (this.store as any).db.prepare(
          'SELECT content_hash FROM synced_files WHERE file_path = ?'
        ).get(filePath) as any;

        if (existing?.content_hash === hash) continue;
      }

      stats.filesChanged++;

      // Remove old synced memories for this file
      const oldMemories = (this.store as any).db.prepare(
        'SELECT memory_id FROM synced_memories WHERE file_path = ?'
      ).all(filePath) as any[];

      for (const { memory_id } of oldMemories) {
        this.store.deleteMemory(memory_id);
        stats.oldFactsRemoved++;
      }
      (this.store as any).db.prepare(
        'DELETE FROM synced_memories WHERE file_path = ?'
      ).run(filePath);

      // Extract and store new facts
      const relPath = relative(workspacePath, filePath);
      const facts = this.extractFacts(content, relPath);

      for (const fact of facts) {
        if (this.isNoise(fact.content)) {
          stats.factsSkipped++;
          continue;
        }

        const memory = this.store.createMemory({
          content: fact.content,
          summary: fact.content.length > 120 ? fact.content.slice(0, 117) + '...' : undefined,
          attribution: {
            type: fact.sourceType,
            context: `Synced from ${fact.sourceFile} → ${fact.section}`,
          },
          entities: fact.entities,
          tags: [...fact.tags, 'synced'],
          category: fact.category,
          pinned: fact.pinned,
        });

        // Track which file this memory came from
        (this.store as any).db.prepare(
          'INSERT OR IGNORE INTO synced_memories (memory_id, file_path) VALUES (?, ?)'
        ).run(memory.id, filePath);

        stats.factsExtracted++;
      }

      // Update file tracking
      (this.store as any).db.prepare(`
        INSERT OR REPLACE INTO synced_files (file_path, content_hash, last_synced, facts_count)
        VALUES (?, ?, ?, ?)
      `).run(filePath, hash, Date.now(), facts.length - stats.factsSkipped);
    }

    return stats;
  }

  /**
   * Get sync status for all tracked files.
   */
  status(): Array<{ filePath: string; lastSynced: number; factsCount: number }> {
    return (this.store as any).db.prepare(
      'SELECT file_path as filePath, last_synced as lastSynced, facts_count as factsCount FROM synced_files ORDER BY last_synced DESC'
    ).all() as any[];
  }

  /**
   * Collect markdown files to sync from workspace.
   */
  private collectFiles(workspacePath: string): string[] {
    const files: string[] = [];

    // MEMORY.md
    const memoryMd = join(workspacePath, 'MEMORY.md');
    if (existsSync(memoryMd)) files.push(memoryMd);

    // memory/*.md (daily logs and other context files)
    const memoryDir = join(workspacePath, 'memory');
    if (existsSync(memoryDir)) {
      for (const entry of readdirSync(memoryDir)) {
        const fullPath = join(memoryDir, entry);
        if (entry.endsWith('.md') && statSync(fullPath).isFile()) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Extract meaningful facts from markdown content.
   * Groups content by section, extracts bullet points as atomic facts,
   * and merges continuation lines.
   */
  extractFacts(content: string, sourceFile: string): ExtractedFact[] {
    const sections = this.parseSections(content);
    const facts: ExtractedFact[] = [];

    for (const section of sections) {
      for (const item of section.items) {
        const cleaned = item.trim();
        if (!cleaned) continue;

        facts.push({
          content: cleaned,
          section: section.heading,
          sourceFile,
          sourceType: this.classifySource(cleaned),
          category: this.classifyCategory(cleaned, section.heading),
          entities: this.extractEntities(cleaned),
          tags: this.extractTags(section.heading, sourceFile),
          pinned: this.shouldPin(section.heading),
        });
      }
    }

    return facts;
  }

  /**
   * Parse markdown into sections with grouped items.
   * Bullet points become individual items. Paragraphs are kept whole.
   * Headers alone are skipped.
   */
  private parseSections(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split('\n');

    let currentHeading = 'Top';
    let currentLevel = 0;
    let currentItems: string[] = [];
    let currentItem: string[] = [];

    const flushItem = () => {
      if (currentItem.length > 0) {
        const text = currentItem.join(' ').trim();
        if (text) currentItems.push(text);
        currentItem = [];
      }
    };

    const flushSection = () => {
      flushItem();
      if (currentItems.length > 0) {
        sections.push({
          heading: currentHeading,
          headingLevel: currentLevel,
          items: currentItems,
        });
      }
      currentItems = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headingMatch) {
        flushSection();
        currentHeading = headingMatch[2].trim();
        currentLevel = headingMatch[1].length;
        continue;
      }

      // Top-level bullet point = new item
      if (/^[-*]\s+/.test(line)) {
        flushItem();
        currentItem.push(line.replace(/^[-*]\s+/, '').trim());
        continue;
      }

      // Indented continuation (sub-bullets or indented text)
      if (/^\s{2,}[-*]\s+/.test(line)) {
        // Sub-bullet: append to current item
        currentItem.push(line.replace(/^\s+[-*]\s+/, '').trim());
        continue;
      }

      if (/^\s{2,}/.test(line) && currentItem.length > 0) {
        // Indented continuation text
        currentItem.push(line.trim());
        continue;
      }

      // Blank line = potential item boundary
      if (!line.trim()) {
        flushItem();
        continue;
      }

      // Regular paragraph line
      if (currentItem.length > 0) {
        currentItem.push(line.trim());
      } else {
        currentItem.push(line.trim());
      }
    }

    flushSection();
    return sections;
  }

  /**
   * Filter out noise — things that aren't worth storing as memories.
   */
  isNoise(content: string): boolean {
    // Too short to be meaningful
    if (content.length < 20) return true;

    // Strikethrough items (completed/cancelled)
    if (/^~~.*~~$/.test(content)) return true;

    // Pure formatting / boilerplate
    if (/^(---+|\*\*\*+|===+)$/.test(content)) return true;

    // Just a date or timestamp
    if (/^\d{4}-\d{2}-\d{2}$/.test(content.trim())) return true;

    // Section markers with no content
    if (/^(TODO|FIXME|NOTE|TBD):?\s*$/.test(content)) return true;

    return false;
  }

  // === Classification ===

  private classifySource(text: string): SourceType {
    const lower = text.toLowerCase();

    if (/\b(told me|said|"[^"]{5,}"|his words?|her words?|they said)\b/.test(lower)) return 'told';
    if (/\bshaun('s guidance|'s words| asked| wants| offered| approved| facilitat)/i.test(lower)) return 'told';
    if (/\b(i read|article|blog|documentation|found on)\b/.test(lower)) return 'read';
    if (/\b(i think|i believe|seems like|probably|likely|strong candidate)\b/.test(lower)) return 'inferred';
    if (/\b(i noticed|i observed|i saw)\b/.test(lower)) return 'observed';
    if (/\b(i did|i built|i found|i tried|i created|implemented|configured|set up|published)\b/.test(lower)) return 'experienced';
    if (/\b(api|endpoint|config|port |path:|token|key:|bearer)\b/.test(lower)) return 'experienced';

    return 'read'; // Default for synced content: "read from file" not "experienced"
  }

  private classifyCategory(text: string, heading: string): MemoryCategory {
    const lower = text.toLowerCase();
    const headingLower = heading.toLowerCase();

    // Heading-based classification
    if (headingLower.includes('lesson') || headingLower.includes('guidance')) return 'observation';
    if (headingLower.includes('preference')) return 'preference';
    if (headingLower.includes('identity')) return 'fact';
    if (headingLower.includes('account') || headingLower.includes('config')) return 'procedure';
    if (headingLower.includes('project')) return 'fact';

    // Content-based
    if (/\b(api|endpoint|command|config|how to|bearer|token|port \d)\b/.test(lower)) return 'procedure';
    if (/\b(prefers?|likes?|wants|favorite|don't like)\b/.test(lower)) return 'preference';
    if (/\b(i think|i believe|opinion|strong candidate)\b/.test(lower)) return 'opinion';
    if (/\b(happened|born|created|started|launched|published|set up)\b/.test(lower)) return 'event';
    if (/\b(is a |works at|lives in|friend|peer|mentor|human|agent)\b/.test(lower)) return 'relationship';

    return 'fact';
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    const patterns: Record<string, string> = {
      'shaun': 'shaun', '@oscarmiike': 'shaun',
      'mantis': 'mantis', 'moonshot': 'moonshot', 'super-eureka': 'moonshot',
      'molt report': 'molt-report', 'themoltreport': 'molt-report', 'moltbook': 'moltbook',
      'openclaw': 'openclaw', 'clawdhub': 'clawdhub', 'agentmail': 'agentmail',
      'rufio': 'rufio', 'agent-memory': 'agent-memory', 'clawdia': 'clawdia',
    };

    const lower = text.toLowerCase();
    for (const [pattern, id] of Object.entries(patterns)) {
      if (lower.includes(pattern)) entities.push(id);
    }

    return [...new Set(entities)];
  }

  private extractTags(heading: string, sourceFile: string): string[] {
    const tags: string[] = [];
    const lower = heading.toLowerCase();

    if (lower.includes('project')) tags.push('project');
    if (lower.includes('lesson')) tags.push('lesson');
    if (lower.includes('config')) tags.push('config');
    if (lower.includes('identity')) tags.push('identity');
    if (lower.includes('guidance')) tags.push('guidance');

    // Daily log tag
    const dateMatch = sourceFile.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) tags.push('daily-log', dateMatch[1]);

    // Source file tag
    if (sourceFile === 'MEMORY.md') tags.push('curated');

    return tags;
  }

  private shouldPin(heading: string): boolean {
    const lower = heading.toLowerCase();
    return lower.includes('identity') || lower.includes('lesson');
  }
}
