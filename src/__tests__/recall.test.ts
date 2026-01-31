import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../store.js';
import { RecallEngine } from '../recall.js';

let store: MemoryStore;
let recall: RecallEngine;

beforeEach(() => {
  store = new MemoryStore(':memory:');
  recall = new RecallEngine(store);

  // Seed test data
  store.createEntity({ id: 'shaun', name: 'Shaun', type: 'person' });
  store.createEntity({ id: 'rufio', name: 'Rufio', type: 'person' });

  store.createMemory({
    content: 'Shaun gave me full autonomy to make decisions',
    summary: 'Full autonomy from Shaun',
    attribution: { type: 'told', actor: 'shaun', context: 'Direct conversation' },
    entities: ['shaun'],
    category: 'event',
  });

  store.createMemory({
    content: 'Rufio found a credential stealer on ClawdHub',
    summary: 'ClawdHub credential stealer (by Rufio)',
    attribution: { type: 'read', actor: 'rufio', context: 'Moltbook post' },
    entities: ['rufio'],
    tags: ['security'],
    category: 'event',
  });

  store.createMemory({
    content: 'AgentMail uses flat {to, subject, text} format',
    summary: 'AgentMail API format',
    attribution: { type: 'experienced', context: 'Trial and error' },
    category: 'procedure',
    pinned: true,
  });

  store.createMemory({
    content: 'I think attribution is the biggest gap in agent memory',
    summary: 'Attribution is the biggest memory gap',
    attribution: { type: 'inferred', context: 'Research' },
    category: 'opinion',
  });
});

afterEach(() => {
  store.close();
});

describe('RecallEngine', () => {
  describe('quickRecall', () => {
    it('finds memories by content', () => {
      const results = recall.quickRecall('credential stealer');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.content).toContain('credential stealer');
    });

    it('ranks by finalScore (match × confidence × relevance)', () => {
      const results = recall.quickRecall('AgentMail format');
      expect(results.length).toBeGreaterThan(0);
      // Experienced memory should rank high (0.95 confidence)
      expect(results[0].memory.attribution.type).toBe('experienced');
    });

    it('returns empty for no matches', () => {
      const results = recall.quickRecall('xyzzy nonexistent query');
      expect(results.length).toBe(0);
    });
  });

  describe('entityRecall', () => {
    it('returns all memories for an entity', () => {
      const results = recall.entityRecall('shaun');
      expect(results.length).toBe(1);
      expect(results[0].memory.content).toContain('Shaun');
    });

    it('returns empty for unknown entity', () => {
      const results = recall.entityRecall('nobody');
      expect(results.length).toBe(0);
    });
  });

  describe('recall (full pipeline)', () => {
    it('filters by minimum confidence', async () => {
      const results = await recall.recall({
        text: 'attribution memory gap',
        minConfidence: 0.5, // Should exclude inferred (0.4)
      });
      
      for (const r of results) {
        expect(r.memory.confidence.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('filters by category', async () => {
      const results = await recall.recall({
        text: 'format',
        categories: ['procedure'],
      });

      for (const r of results) {
        expect(r.memory.category).toBe('procedure');
      }
    });

    it('boosts results matching query entities', async () => {
      const results = await recall.recall({
        text: 'what happened',
        entities: ['shaun'],
      });

      expect(results.length).toBeGreaterThan(0);
      // Shaun-linked memory should be present
      const shaunResult = results.find(r => r.memory.entities.includes('shaun'));
      expect(shaunResult).toBeTruthy();
    });
  });

  describe('formatResults', () => {
    it('includes attribution in output', () => {
      const results = recall.quickRecall('credential');
      const formatted = recall.formatResults(results);
      
      expect(formatted).toContain('read');
      expect(formatted).toContain('rufio');
      expect(formatted).toContain('55%');
    });

    it('shows pinned indicator', () => {
      const results = recall.quickRecall('AgentMail');
      const formatted = recall.formatResults(results);
      
      expect(formatted).toContain('📌 Pinned');
    });

    it('returns message for empty results', () => {
      const formatted = recall.formatResults([]);
      expect(formatted).toBe('No memories found.');
    });
  });
});
