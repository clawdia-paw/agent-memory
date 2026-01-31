/**
 * Agent Memory — Import Tool
 * 
 * Converts existing flat-file memories (MEMORY.md, daily logs)
 * into structured Memory objects with attribution.
 * 
 * This is the bridge from "notes in a file" to "memories with provenance."
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { MemoryStore } from './store.js';
import { CreateMemoryInput, SourceType, MemoryCategory } from './types.js';

interface ImportStats {
  filesProcessed: number;
  memoriesCreated: number;
  entitiesCreated: number;
  skipped: number;
}

export class MemoryImporter {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Import a MEMORY.md file — curated long-term memories.
   * Parses sections and creates structured memories from each entry.
   */
  importMemoryMd(filePath: string): ImportStats {
    const stats: ImportStats = { filesProcessed: 1, memoriesCreated: 0, entitiesCreated: 0, skipped: 0 };
    
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return stats;
    }

    const content = readFileSync(filePath, 'utf-8');
    const sections = this.parseSections(content);

    for (const section of sections) {
      const entries = this.parseEntries(section.content);
      
      for (const entry of entries) {
        try {
          const input = this.classifyEntry(entry, section.heading);
          this.store.createMemory(input);
          stats.memoriesCreated++;
        } catch (e) {
          stats.skipped++;
        }
      }
    }

    return stats;
  }

  /**
   * Import daily log files from memory/ directory.
   * These are raw, chronological — lower base confidence than curated MEMORY.md.
   */
  importDailyLogs(dirPath: string): ImportStats {
    const stats: ImportStats = { filesProcessed: 0, memoriesCreated: 0, entitiesCreated: 0, skipped: 0 };

    if (!existsSync(dirPath)) {
      console.error(`Directory not found: ${dirPath}`);
      return stats;
    }

    const files = readdirSync(dirPath)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();

    for (const file of files) {
      const date = file.replace('.md', '');
      const content = readFileSync(join(dirPath, file), 'utf-8');
      const entries = this.parseLogEntries(content);

      for (const entry of entries) {
        try {
          const input: CreateMemoryInput = {
            content: entry.text,
            attribution: {
              type: this.inferSourceType(entry.text),
              context: `Daily log: ${date}`,
            },
            entities: this.extractEntities(entry.text),
            tags: ['daily-log', date],
            category: this.inferCategory(entry.text),
          };
          this.store.createMemory(input);
          stats.memoriesCreated++;
        } catch (e) {
          stats.skipped++;
        }
      }
      stats.filesProcessed++;
    }

    return stats;
  }

  // === Parsing ===

  private parseSections(content: string): Array<{ heading: string; content: string }> {
    const sections: Array<{ heading: string; content: string }> = [];
    const lines = content.split('\n');
    let currentHeading = 'Untitled';
    let currentContent: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        if (currentContent.length > 0) {
          sections.push({ heading: currentHeading, content: currentContent.join('\n') });
        }
        currentHeading = headingMatch[1].trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections.push({ heading: currentHeading, content: currentContent.join('\n') });
    }

    return sections;
  }

  private parseEntries(content: string): string[] {
    // Split on list items (- or *) that are top-level entries
    const entries: string[] = [];
    const lines = content.split('\n');
    let current: string[] = [];

    for (const line of lines) {
      if (/^[-*]\s+\*\*/.test(line) || /^[-*]\s+[A-Z]/.test(line)) {
        if (current.length > 0) {
          entries.push(current.join(' ').trim());
        }
        current = [line.replace(/^[-*]\s+/, '')];
      } else if (line.trim() && current.length > 0) {
        current.push(line.trim());
      }
    }

    if (current.length > 0) {
      entries.push(current.join(' ').trim());
    }

    return entries.filter(e => e.length > 10);
  }

  private parseLogEntries(content: string): Array<{ text: string; time?: string }> {
    const entries: Array<{ text: string; time?: string }> = [];
    const lines = content.split('\n');
    let current: string[] = [];

    for (const line of lines) {
      // Detect entry boundaries: timestamps, headers, or list items
      if (/^#{1,4}\s/.test(line) || /^[-*]\s/.test(line) || /^\d{1,2}:\d{2}/.test(line)) {
        if (current.length > 0) {
          entries.push({ text: current.join(' ').trim() });
        }
        current = [line.replace(/^[-*]\s+/, '').replace(/^#{1,4}\s+/, '')];
      } else if (line.trim()) {
        current.push(line.trim());
      }
    }

    if (current.length > 0) {
      entries.push({ text: current.join(' ').trim() });
    }

    return entries.filter(e => e.text.length > 10);
  }

  // === Classification ===

  private classifyEntry(text: string, sectionHeading: string): CreateMemoryInput {
    return {
      content: text,
      summary: text.length > 100 ? text.slice(0, 97) + '...' : undefined,
      attribution: {
        type: this.inferSourceType(text),
        context: `MEMORY.md section: ${sectionHeading}`,
      },
      entities: this.extractEntities(text),
      tags: this.extractTags(sectionHeading),
      category: this.inferCategory(text),
      pinned: sectionHeading.toLowerCase().includes('lesson') || sectionHeading.toLowerCase().includes('identity'),
    };
  }

  private inferSourceType(text: string): SourceType {
    const lower = text.toLowerCase();
    
    // Direct experience indicators
    if (/\b(i did|i built|i found|i tried|i discovered|i created|i wrote)\b/.test(lower)) return 'experienced';
    if (/\b(i noticed|i observed|i saw|i watched)\b/.test(lower)) return 'observed';
    if (/\b(told me|said|his words|her words|they said)\b/.test(lower)) return 'told';
    if (/\b(i read|article|post|documentation|docs)\b/.test(lower)) return 'read';
    if (/\b(i think|i believe|seems like|probably|likely|my theory)\b/.test(lower)) return 'inferred';
    
    // Default: if it's in MEMORY.md, it's likely experienced or read
    return 'experienced';
  }

  private inferCategory(text: string): MemoryCategory {
    const lower = text.toLowerCase();
    
    if (/\b(api|endpoint|format|command|config|use|how to|run|install)\b/.test(lower)) return 'procedure';
    if (/\b(i think|i believe|opinion|should|better|worse|prefer)\b/.test(lower)) return 'opinion';
    if (/\b(happened|event|born|created|started|launched|published)\b/.test(lower)) return 'event';
    if (/\b(prefers?|likes?|wants?|favorite|always)\b/.test(lower)) return 'preference';
    if (/\b(is a|works at|lives in|relationship|friend|peer|mentor)\b/.test(lower)) return 'relationship';
    
    return 'fact';
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    const knownEntities: Record<string, string> = {
      'shaun': 'shaun',
      'mantis': 'mantis',
      'moonshot': 'moonshot',
      'molt report': 'molt-report',
      'the molt report': 'molt-report',
      'moltbook': 'moltbook',
      'openclaw': 'openclaw',
      'clawdhub': 'clawdhub',
      'agentmail': 'agentmail',
      'rufio': 'rufio',
    };

    const lower = text.toLowerCase();
    for (const [pattern, id] of Object.entries(knownEntities)) {
      if (lower.includes(pattern)) {
        entities.push(id);
      }
    }

    return [...new Set(entities)];
  }

  private extractTags(heading: string): string[] {
    const tags: string[] = [];
    const lower = heading.toLowerCase();
    
    if (lower.includes('project')) tags.push('project');
    if (lower.includes('lesson')) tags.push('lesson');
    if (lower.includes('config')) tags.push('config');
    if (lower.includes('account')) tags.push('account');
    if (lower.includes('identity')) tags.push('identity');
    if (lower.includes('guidance')) tags.push('guidance');
    
    return tags;
  }
}
