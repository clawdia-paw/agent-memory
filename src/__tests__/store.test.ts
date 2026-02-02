import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../store.js';

let store: MemoryStore;

beforeEach(() => {
  store = new MemoryStore(':memory:');
});

afterEach(() => {
  store.close();
});

describe('MemoryStore', () => {
  describe('createMemory', () => {
    it('creates a memory with mandatory attribution', () => {
      const mem = store.createMemory({
        content: 'Test memory content',
        attribution: { type: 'experienced', context: 'unit test' },
        category: 'fact',
      });

      expect(mem.id).toBeTruthy();
      expect(mem.content).toBe('Test memory content');
      expect(mem.attribution.type).toBe('experienced');
      expect(mem.confidence.score).toBe(0.95); // experienced + context
      expect(mem.relevanceScore).toBe(1.0);
    });

    it('assigns confidence based on source type', () => {
      const experienced = store.createMemory({
        content: 'I did this',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      const told = store.createMemory({
        content: 'Someone told me',
        attribution: { type: 'told', actor: 'shaun' },
        category: 'fact',
      });
      const read = store.createMemory({
        content: 'I read about it',
        attribution: { type: 'read' },
        category: 'fact',
      });
      const inferred = store.createMemory({
        content: 'I think this',
        attribution: { type: 'inferred' },
        category: 'opinion',
      });

      expect(experienced.confidence.score).toBe(0.9);
      expect(told.confidence.score).toBe(0.6);
      expect(read.confidence.score).toBe(0.5);
      expect(inferred.confidence.score).toBe(0.4);
    });

    it('boosts confidence when context is provided', () => {
      const withContext = store.createMemory({
        content: 'Has context',
        attribution: { type: 'told', actor: 'shaun', context: 'conversation' },
        category: 'fact',
      });
      const without = store.createMemory({
        content: 'No context',
        attribution: { type: 'told', actor: 'shaun' },
        category: 'fact',
      });

      expect(withContext.confidence.score).toBeGreaterThan(without.confidence.score);
    });

    it('assigns decay rate based on category', () => {
      const fact = store.createMemory({
        content: 'A fact', attribution: { type: 'experienced' }, category: 'fact',
      });
      const opinion = store.createMemory({
        content: 'An opinion', attribution: { type: 'inferred' }, category: 'opinion',
      });
      const observation = store.createMemory({
        content: 'An observation', attribution: { type: 'observed' }, category: 'observation',
      });

      expect(fact.decayRate).toBe(0.1);
      expect(opinion.decayRate).toBe(0.35);
      expect(observation.decayRate).toBe(0.4);
    });
  });

  describe('entities', () => {
    it('creates and retrieves entities', () => {
      store.createEntity({ id: 'shaun', name: 'Shaun', type: 'person' });
      const entity = store.getEntity('shaun');

      expect(entity).toBeTruthy();
      expect(entity!.name).toBe('Shaun');
      expect(entity!.type).toBe('person');
    });

    it('links memories to entities', () => {
      store.createEntity({ id: 'shaun', name: 'Shaun', type: 'person' });
      store.createMemory({
        content: 'Something about Shaun',
        attribution: { type: 'experienced' },
        category: 'fact',
        entities: ['shaun'],
      });

      const memories = store.getEntityMemories('shaun');
      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe('Something about Shaun');
    });

    it('auto-creates entities when linking', () => {
      store.createMemory({
        content: 'About a new entity',
        attribution: { type: 'experienced' },
        category: 'fact',
        entities: ['new-entity'],
      });

      const entity = store.getEntity('new-entity');
      expect(entity).toBeTruthy();
    });
  });

  describe('search', () => {
    it('finds memories by text', () => {
      store.createMemory({
        content: 'The quick brown fox jumped over the lazy dog',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      store.createMemory({
        content: 'Something completely different',
        attribution: { type: 'experienced' },
        category: 'fact',
      });

      const results = store.searchByText('fox jumped');
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('fox');
    });

    it('searches tags', () => {
      store.createMemory({
        content: 'A tagged memory',
        attribution: { type: 'experienced' },
        category: 'fact',
        tags: ['important', 'security'],
      });

      const results = store.searchByText('security');
      expect(results.length).toBe(1);
    });
  });

  describe('pinning', () => {
    it('pinned memories are exempt from decay', () => {
      store.createMemory({
        content: 'Pinned memory',
        attribution: { type: 'experienced' },
        category: 'fact',
        pinned: true,
      });

      const decay = store.applyDecay();
      const mem = store.getAllMemories()[0];
      expect(mem.pinned).toBe(true);
      expect(mem.relevanceScore).toBe(1.0);
    });
  });

  describe('frequency resistance in decay', () => {
    it('frequently-accessed memories decay slower than rarely-accessed ones', () => {
      // Create two memories with the same category/decay rate
      const frequent = store.createMemory({
        content: 'Frequently accessed',
        attribution: { type: 'experienced' },
        category: 'event',
      });
      const rare = store.createMemory({
        content: 'Rarely accessed',
        attribution: { type: 'experienced' },
        category: 'event',
      });

      // Simulate frequent access (20 times) — getMemory increments access_count
      for (let i = 0; i < 20; i++) {
        store.getMemory(frequent.id);
      }

      // Backdate both memories' last_accessed to 15 days ago
      const fifteenDaysAgo = Date.now() - 15 * 86400000;
      const db = (store as any).db;
      db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?').run(fifteenDaysAgo, frequent.id);
      db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?').run(fifteenDaysAgo, rare.id);

      store.applyDecay();

      const freqMem = store.getMemory(frequent.id)!;
      const rareMem = store.getMemory(rare.id)!;

      // Frequently accessed should have higher relevance (slower decay)
      expect(freqMem.relevanceScore).toBeGreaterThan(rareMem.relevanceScore);
    });

    it('zero-access memories decay at base rate', () => {
      const mem = store.createMemory({
        content: 'Never accessed after creation',
        attribution: { type: 'experienced' },
        category: 'fact',
      });

      // Backdate to 10 days ago
      const tenDaysAgo = Date.now() - 10 * 86400000;
      const db = (store as any).db;
      db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?').run(tenDaysAgo, mem.id);

      store.applyDecay();

      const updated = store.getMemory(mem.id)!;
      // Should decay at base rate: e^(-0.1 * 10 * 0.01) ≈ 0.99 for fact category
      expect(updated.relevanceScore).toBeLessThan(1.0);
      expect(updated.relevanceScore).toBeGreaterThan(0.9);
    });
  });

  describe('decay tiers', () => {
    it('returns hot for recently accessed memories', () => {
      const mem = store.createMemory({
        content: 'Recent',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      expect(store.getDecayTier(mem)).toBe('hot');
    });

    it('returns warm for memories accessed 8-30 days ago', () => {
      const mem = store.createMemory({
        content: 'Older',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      // Fake lastAccessed to 15 days ago
      mem.lastAccessed = Date.now() - 15 * 86400000;
      mem.accessCount = 0;
      expect(store.getDecayTier(mem)).toBe('warm');
    });

    it('returns cold for memories not accessed in 30+ days', () => {
      const mem = store.createMemory({
        content: 'Old',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      mem.lastAccessed = Date.now() - 45 * 86400000;
      mem.accessCount = 0;
      expect(store.getDecayTier(mem)).toBe('cold');
    });

    it('promotes high-frequency memories one tier', () => {
      const mem = store.createMemory({
        content: 'Frequent but old',
        attribution: { type: 'experienced' },
        category: 'fact',
      });
      // 45 days old but accessed 15 times → cold promoted to warm
      mem.lastAccessed = Date.now() - 45 * 86400000;
      mem.accessCount = 15;
      expect(store.getDecayTier(mem)).toBe('warm');

      // 15 days old with high access → warm promoted to hot
      mem.lastAccessed = Date.now() - 15 * 86400000;
      expect(store.getDecayTier(mem)).toBe('hot');
    });
  });

  describe('stats', () => {
    it('returns correct stats', () => {
      store.createMemory({ content: 'A', attribution: { type: 'experienced' }, category: 'fact' });
      store.createMemory({ content: 'B', attribution: { type: 'told', actor: 'x' }, category: 'fact' });
      store.createEntity({ id: 'test', name: 'Test', type: 'concept' });

      const stats = store.getStats();
      expect(stats.memories).toBe(2);
      expect(stats.entities).toBe(1);
      expect(stats.avgConfidence).toBeGreaterThan(0);
    });
  });
});
