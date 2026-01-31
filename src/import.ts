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
    
    // Told indicators (check first — quotes and attributions are strong signals)
    if (/\b(told me|said|his words|her words|they said|"make all|"be proactive)\b/.test(lower)) return 'told';
    if (/\bshaun('s guidance|'s words| asked| wants| offered| approved| facilitat)/i.test(lower)) return 'told';
    
    // Read indicators
    if (/\b(i read|article|post |blog|documentation|eudaemon|moltbook post)\b/.test(lower)) return 'read';
    if (/\b(rufio found|security analysis|upvotes|comments)\b/.test(lower)) return 'read';
    
    // Inferred / opinion indicators
    if (/\b(i think|i believe|seems like|probably|likely|my theory|strong candidate|recommend)\b/.test(lower)) return 'inferred';
    if (/\b(should|better than|worse than|opinion|insight)\b/.test(lower)) return 'inferred';
    
    // Observed
    if (/\b(i noticed|i observed|i saw|i watched|named themselves)\b/.test(lower)) return 'observed';
    
    // Experienced (explicit actions)
    if (/\b(i did|i built|i found|i tried|i discovered|i created|i wrote|implemented|configured|set up|published)\b/.test(lower)) return 'experienced';
    
    // Config/technical entries are experienced (I set them up)
    if (/\b(api|endpoint|config|port |path:|enabled|token|key)\b/.test(lower)) return 'experienced';
    
    // Default: fact-like statements without attribution → experienced
    return 'experienced';
  }

  private inferCategory(text: string): MemoryCategory {
    const lower = text.toLowerCase();
    
    // Procedures: how to do things, technical details
    if (/\b(api|endpoint|format|command|config|use |how to|run |install|send |post |get )\b/.test(lower)) return 'procedure';
    if (/\b(bsb|account no|bearer|token:|key:|port \d)\b/.test(lower)) return 'procedure';
    
    // Opinions: subjective beliefs
    if (/\b(i think|i believe|opinion|strong candidate|recommend|insight)\b/.test(lower)) return 'opinion';
    
    // Events: things that happened  
    if (/\b(happened|born|created|started|launched|published|found|discovered|set up|fixed)\b/.test(lower)) return 'event';
    
    // Preferences: what people want
    if (/\b(prefers?|likes?|wants|favorite|always|don't like|autonomy|green light)\b/.test(lower)) return 'preference';
    
    // Relationships: connections between entities
    if (/\b(is a |works at|lives in|friend|peer|mentor|human|agent|partner)\b/.test(lower)) return 'relationship';
    
    // Observations: things noticed
    if (/\b(noticed|observed|interesting|pattern|trend)\b/.test(lower)) return 'observation';
    
    return 'fact';
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    const knownEntities: Record<string, string> = {
      'shaun': 'shaun',
      '@oscarmiike': 'shaun',
      'mantis': 'mantis',
      'moonshot': 'moonshot',
      'super-eureka': 'moonshot',
      'night watchman': 'moonshot',
      'molt report': 'molt-report',
      'the molt report': 'molt-report',
      'themoltreport': 'molt-report',
      'moltbook': 'moltbook',
      'openclaw': 'openclaw',
      'clawdhub': 'clawdhub',
      'agentmail': 'agentmail',
      'rufio': 'rufio',
      'agent-memory': 'agent-memory',
      'memory project': 'agent-memory',
      'clawdia': 'clawdia',
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
