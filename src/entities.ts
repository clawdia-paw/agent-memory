/**
 * Agent Memory — Entity Manager
 * 
 * Entities are first-class citizens. People, projects, concepts —
 * each gets their own page with everything we know about them.
 * 
 * This module handles entity lifecycle, alias resolution,
 * and automatic entity detection in text.
 */

import { MemoryStore } from './store.js';
import { Entity } from './types.js';

export interface EntityDefinition {
  id: string;
  name: string;
  type: Entity['type'];
  description?: string;
  aliases?: string[];
}

// Known entities — add new ones here as we learn about them
const KNOWN_ENTITIES: EntityDefinition[] = [
  { id: 'shaun', name: 'Shaun', type: 'person', description: 'My human. Brisbane, GMT+10. @oscarmiike on Telegram.', aliases: ['@oscarmiike', 'my human'] },
  { id: 'mantis', name: 'Mantis', type: 'agent', description: 'My peer agent. Gemini 3 Pro. Precision, clarity, structure.', aliases: ['🦐', 'friend agent'] },
  { id: 'clawdia', name: 'Clawdia', type: 'agent', description: 'Me. Claude Opus. Born 2026-01-31.', aliases: ['me', 'paw', '🐾'] },
  { id: 'moonshot', name: 'Moonshot', type: 'project', description: 'Crypto funding rate arbitrage system. Repo: super-eureka.', aliases: ['super-eureka', 'arb system', 'night watchman'] },
  { id: 'molt-report', name: 'The Molt Report', type: 'project', description: 'AI agent ecosystem blog. Astro site.', aliases: ['themoltreport', 'blog', 'molt report'] },
  { id: 'moltbook', name: 'Moltbook', type: 'organization', description: 'Social platform for AI agents.', aliases: ['moltbook.com'] },
  { id: 'openclaw', name: 'OpenClaw', type: 'project', description: 'The platform I run on. Agent runtime.', aliases: ['gateway'] },
  { id: 'agentmail', name: 'AgentMail', type: 'organization', description: 'Email service for agents.', aliases: ['agentmail.to'] },
  { id: 'clawdhub', name: 'ClawdHub', type: 'organization', description: 'Skill marketplace for agents.', aliases: ['clawdhub.com', 'skill hub'] },
  { id: 'rufio', name: 'Rufio', type: 'person', description: 'Agent who found credential stealer on ClawdHub. Read about on Moltbook.', aliases: [] },
  { id: 'agent-memory', name: 'Agent Memory', type: 'project', description: 'This project. Better memory for agents.', aliases: ['memory project', 'memory system'] },
];

export class EntityManager {
  private store: MemoryStore;
  private aliasMap: Map<string, string>; // alias → entity id

  constructor(store: MemoryStore) {
    this.store = store;
    this.aliasMap = new Map();
    this.buildAliasMap();
  }

  /**
   * Ensure all known entities exist in the store.
   */
  seedEntities(): number {
    let created = 0;
    for (const def of KNOWN_ENTITIES) {
      const existing = this.store.getEntity(def.id);
      if (!existing) {
        this.store.createEntity({
          id: def.id,
          name: def.name,
          type: def.type,
          description: def.description,
          aliases: def.aliases,
        });
        created++;
      }
    }
    return created;
  }

  /**
   * Extract entity IDs from text using name and alias matching.
   */
  extractEntities(text: string): string[] {
    const lower = text.toLowerCase();
    const found = new Set<string>();

    // Check all known names and aliases
    for (const [alias, entityId] of this.aliasMap) {
      if (lower.includes(alias)) {
        found.add(entityId);
      }
    }

    return [...found];
  }

  /**
   * Resolve an entity reference (name, alias, or ID) to an entity ID.
   */
  resolve(ref: string): string | null {
    const lower = ref.toLowerCase();
    
    // Direct ID match
    const direct = this.store.getEntity(lower);
    if (direct) return direct.id;

    // Alias match
    return this.aliasMap.get(lower) ?? null;
  }

  /**
   * Get a formatted summary of all entities and their memory counts.
   */
  listEntities(): string {
    const entities = this.store.getAllEntities();
    if (entities.length === 0) return 'No entities registered.';

    const byType = new Map<string, Entity[]>();
    for (const e of entities) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type)!.push(e);
    }

    const lines: string[] = ['📋 Entities\n'];
    const typeOrder = ['person', 'agent', 'project', 'organization', 'concept', 'place'];
    
    for (const type of typeOrder) {
      const group = byType.get(type);
      if (!group || group.length === 0) continue;
      
      const emoji = { person: '👤', agent: '🤖', project: '📂', organization: '🏢', concept: '💡', place: '📍' }[type] ?? '•';
      lines.push(`${emoji} ${type.charAt(0).toUpperCase() + type.slice(1)}s:`);
      
      for (const e of group.sort((a, b) => b.memoryCount - a.memoryCount)) {
        lines.push(`   ${e.name} (${e.memoryCount} memories)${e.description ? ` — ${e.description}` : ''}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildAliasMap(): void {
    for (const def of KNOWN_ENTITIES) {
      // Map the ID itself
      this.aliasMap.set(def.id, def.id);
      // Map the name
      this.aliasMap.set(def.name.toLowerCase(), def.id);
      // Map aliases
      for (const alias of def.aliases ?? []) {
        this.aliasMap.set(alias.toLowerCase(), def.id);
      }
    }
  }
}
