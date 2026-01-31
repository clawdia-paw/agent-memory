#!/usr/bin/env node
/**
 * Agent Memory — Holistic Test Suite
 * 
 * Tests the system with realistic scenarios, not just unit tests.
 * Designed to find blind spots before relying on this in production.
 * 
 * Run: npx tsx src/test-holistic.ts
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { ReflectEngine } from './reflect.js';
import { CorroborationEngine } from './corroborate.js';
import { MemoryImporter } from './import.js';
import { EntityManager } from './entities.js';
import { SessionMemory } from './session.js';

let passed = 0;
let failed = 0;
let warnings: string[] = [];

function test(name: string, fn: () => boolean | string) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}: ${result}`);
      failed++;
    }
  } catch (e: any) {
    console.log(`  💥 ${name}: ${e.message}`);
    failed++;
  }
}

function warn(msg: string) {
  warnings.push(msg);
}

// ============================================================
console.log('🧠 Holistic Test Suite\n');
console.log('Testing with REAL data from production DB...\n');

// Test 1: Production DB health
console.log('━━━ 1. Production Database Health ━━━');
{
  const store = new MemoryStore('/home/clawdia/.agent-memory/memory.db');
  const stats = store.getStats();
  
  test('Has meaningful number of memories', () => {
    if (stats.memories < 10) return `Only ${stats.memories} memories — too few for reliable recall`;
    if (stats.memories < 50) warn(`Only ${stats.memories} memories — recall quality will improve with more data`);
    return true;
  });

  test('Has entities', () => {
    if (stats.entities === 0) return 'No entities — memories are unlinked';
    return true;
  });

  test('Average confidence is reasonable (0.4-0.95)', () => {
    if (stats.avgConfidence < 0.4) return `Avg confidence too low: ${stats.avgConfidence}`;
    if (stats.avgConfidence > 0.95) return `Avg confidence suspiciously high: ${stats.avgConfidence} — are attributions properly varied?`;
    return true;
  });

  test('Not all memories are the same source type', () => {
    const all = store.getAllMemories(200);
    const types = new Set(all.map(m => m.attribution.type));
    if (types.size === 1) return `All memories are "${[...types][0]}" — attribution classifier may be broken`;
    if (types.size < 3) warn(`Only ${types.size} source types used — expected more variety`);
    return true;
  });

  test('Not all memories are the same category', () => {
    const all = store.getAllMemories(200);
    const cats = new Set(all.map(m => m.category));
    if (cats.size < 3) return `Only ${cats.size} categories — classifier may need tuning`;
    return true;
  });

  test('Has pinned memories', () => {
    const pinned = store.getAllMemories(200).filter(m => m.pinned);
    if (pinned.length === 0) return 'No pinned memories — important facts may decay';
    return true;
  });

  test('No memories with empty content', () => {
    const empty = store.getAllMemories(500).filter(m => !m.content || m.content.trim().length < 5);
    if (empty.length > 0) return `${empty.length} memories with empty/tiny content`;
    return true;
  });

  test('Embeddings indexed', () => {
    const unindexed = store.getMemoriesWithoutEmbeddings(500);
    if (unindexed.length > 0) return `${unindexed.length} memories missing embeddings`;
    return true;
  });

  store.close();
}

// Test 2: Attribution Distribution
console.log('\n━━━ 2. Attribution Distribution ━━━');
{
  const store = new MemoryStore('/home/clawdia/.agent-memory/memory.db');
  const all = store.getAllMemories(500);
  
  const typeCounts: Record<string, number> = {};
  const catCounts: Record<string, number> = {};
  
  for (const m of all) {
    typeCounts[m.attribution.type] = (typeCounts[m.attribution.type] ?? 0) + 1;
    catCounts[m.category] = (catCounts[m.category] ?? 0) + 1;
  }

  console.log(`  Source types: ${JSON.stringify(typeCounts)}`);
  console.log(`  Categories: ${JSON.stringify(catCounts)}`);

  test('Experienced is not >90% of memories', () => {
    const expPct = (typeCounts['experienced'] ?? 0) / all.length;
    if (expPct > 0.9) return `${Math.round(expPct * 100)}% experienced — attribution classifier is likely defaulting too much`;
    if (expPct > 0.8) warn(`${Math.round(expPct * 100)}% experienced — consider if some should be told/read/inferred`);
    return true;
  });

  test('Has at least one "told" memory', () => {
    if (!typeCounts['told']) return 'No "told" memories — things Shaun said should be tagged as told';
    return true;
  });

  test('Has at least one "read" memory', () => {
    if (!typeCounts['read']) return 'No "read" memories — articles/posts read should be tagged as read';
    return true;
  });

  test('Confidence varies by source type', () => {
    const byType: Record<string, number[]> = {};
    for (const m of all) {
      if (!byType[m.attribution.type]) byType[m.attribution.type] = [];
      byType[m.attribution.type].push(m.confidence.score);
    }
    const avgs: Record<string, number> = {};
    for (const [type, scores] of Object.entries(byType)) {
      avgs[type] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    console.log(`  Avg confidence by type: ${JSON.stringify(avgs)}`);
    
    if (avgs['experienced'] && avgs['read'] && Math.abs(avgs['experienced'] - avgs['read']) < 0.1) {
      return 'Experienced and read have similar confidence — scoring may not be working';
    }
    return true;
  });

  store.close();
}

// Test 3: Recall Quality
console.log('\n━━━ 3. Recall Quality ━━━');
{
  const store = new MemoryStore('/home/clawdia/.agent-memory/memory.db');
  const recall = new RecallEngine(store);

  // Test known-answer queries
  test('Recall finds Shaun-related memories for "my human"', () => {
    const results = recall.quickRecall('my human');
    const hasShaun = results.some(r => 
      r.memory.entities.includes('shaun') || r.memory.content.toLowerCase().includes('shaun')
    );
    if (!hasShaun) return 'Could not find Shaun when searching "my human"';
    return true;
  });

  test('Recall finds path info for "where is molt report code"', () => {
    const results = recall.quickRecall('where is molt report code');
    const hasPath = results.some(r => r.memory.content.includes('molt-report'));
    if (!hasPath) return 'Could not find molt-report path';
    return true;
  });

  test('Recall finds Rufio story with correct attribution', () => {
    const results = recall.quickRecall('credential stealer clawdhub');
    const rufio = results.find(r => r.memory.content.toLowerCase().includes('rufio'));
    if (!rufio) return 'Could not find Rufio/ClawdHub memory';
    if (rufio.memory.attribution.type === 'experienced') return 'Rufio story wrongly tagged as experienced (should be read)';
    return true;
  });

  test('Entity recall works for shaun', () => {
    const results = recall.entityRecall('shaun');
    if (results.length === 0) return 'No memories found for entity shaun';
    if (results.length < 5) warn(`Only ${results.length} memories for shaun — expected more`);
    return true;
  });

  // Test negative cases
  test('Recall returns empty for nonsense query', () => {
    const results = recall.quickRecall('xyzzy frobnicator quantum');
    if (results.length > 2) return `Got ${results.length} results for nonsense query — noise threshold too low`;
    return true;
  });

  // Test recall precision
  test('Top result for specific query is actually relevant', () => {
    const results = recall.quickRecall('agentmail api format');
    if (results.length === 0) return 'No results for agentmail api format';
    const top = results[0];
    const relevant = top.memory.content.toLowerCase().includes('agentmail') || 
                     top.memory.content.toLowerCase().includes('api') ||
                     top.memory.entities.includes('agentmail');
    if (!relevant) return `Top result is not about AgentMail: "${top.memory.content.slice(0, 60)}"`;
    return true;
  });

  store.close();
}

// Test 4: Decay Simulation
console.log('\n━━━ 4. Decay Behaviour ━━━');
{
  // Use a temporary DB to test decay without affecting production
  const store = new MemoryStore(':memory:');
  
  // Create memories with different ages
  const old = store.createMemory({
    content: 'Old memory from weeks ago',
    attribution: { type: 'experienced' },
    category: 'observation',
  });
  // Hack the last_accessed to simulate age
  (store as any).db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?')
    .run(Date.now() - 30 * 86400000, old.id); // 30 days ago

  const recent = store.createMemory({
    content: 'Recent memory from today',
    attribution: { type: 'experienced' },
    category: 'observation',
  });

  const pinned = store.createMemory({
    content: 'Pinned memory that should never decay',
    attribution: { type: 'experienced' },
    category: 'fact',
    pinned: true,
  });

  store.applyDecay();

  const oldMem = store.getMemory(old.id)!;
  const recentMem = store.getMemory(recent.id)!;
  const pinnedMem = store.getMemory(pinned.id)!;

  test('Old memories decay', () => {
    if (oldMem.relevanceScore >= 1.0) return `Old memory didn't decay: ${oldMem.relevanceScore}`;
    return true;
  });

  test('Recent memories retain high relevance', () => {
    if (recentMem.relevanceScore < 0.9) return `Recent memory decayed too much: ${recentMem.relevanceScore}`;
    return true;
  });

  test('Pinned memories never decay', () => {
    if (pinnedMem.relevanceScore < 1.0) return `Pinned memory decayed: ${pinnedMem.relevanceScore}`;
    return true;
  });

  test('Old observation decays faster than old fact would', () => {
    // Observations have decay rate 0.4, facts have 0.1
    // After 30 days, observation should be noticeably lower
    if (oldMem.relevanceScore > 0.95) return `Observation didn't decay enough after 30 days: ${oldMem.relevanceScore}`;
    return true;
  });

  console.log(`  Old observation (30d): relevance=${oldMem.relevanceScore.toFixed(3)}`);
  console.log(`  Recent observation: relevance=${recentMem.relevanceScore.toFixed(3)}`);
  console.log(`  Pinned fact: relevance=${pinnedMem.relevanceScore.toFixed(3)}`);

  store.close();
}

// Test 5: Startup Context Quality
console.log('\n━━━ 5. Startup Context ━━━');
{
  const session = new SessionMemory();
  const context = await session.getStartupContext();
  
  test('Startup context is not empty', () => {
    if (!context || context.length < 100) return 'Startup context too short';
    return true;
  });

  test('Startup context has core memory section', () => {
    if (!context.includes('Core (Pinned)')) return 'Missing Core Memory section';
    return true;
  });

  test('Startup context has entity section', () => {
    if (!context.includes('Entities')) return 'Missing Key Entities section';
    return true;
  });

  test('Startup context includes Shaun', () => {
    if (!context.includes('Shaun')) return 'Shaun not in startup context';
    return true;
  });

  test('Startup context includes identity (Clawdia)', () => {
    if (!context.toLowerCase().includes('clawdia')) return 'Own name not in startup context';
    return true;
  });

  test('Startup context is under 3KB (fits in context window)', () => {
    const bytes = new TextEncoder().encode(context).length;
    if (bytes > 3000) warn(`Startup context is ${bytes} bytes — may use too many tokens`);
    if (bytes > 5000) return `Startup context is ${bytes} bytes — too large`;
    return true;
  });

  const bytes = new TextEncoder().encode(context).length;
  console.log(`  Context size: ${bytes} bytes (~${Math.round(bytes / 4)} tokens)`);

  session.close();
}

// Test 6: Edge Cases
console.log('\n━━━ 6. Edge Cases ━━━');
{
  const store = new MemoryStore(':memory:');

  test('Empty DB doesn\'t crash on recall', () => {
    const recall = new RecallEngine(store);
    const results = recall.quickRecall('anything');
    return results.length === 0 ? true : 'Got results from empty DB';
  });

  test('Empty DB doesn\'t crash on reflect', () => {
    const recall = new RecallEngine(store);
    const reflect = new ReflectEngine(store, recall);
    reflect.reflect();
    return true;
  });

  test('Empty DB doesn\'t crash on stats', () => {
    const stats = store.getStats();
    return stats.memories === 0 ? true : 'Non-zero memories in empty DB';
  });

  test('Very long content is handled', () => {
    const mem = store.createMemory({
      content: 'A'.repeat(10000),
      attribution: { type: 'experienced' },
      category: 'fact',
    });
    return mem.id ? true : 'Failed to create long content memory';
  });

  test('Special characters in content are handled', () => {
    const mem = store.createMemory({
      content: 'Contains "quotes", \'apostrophes\', <html>, & ampersands, 🧠 emoji, and \nnewlines',
      attribution: { type: 'experienced' },
      category: 'fact',
    });
    const retrieved = store.getMemory(mem.id);
    return retrieved?.content.includes('🧠') ? true : 'Special characters lost';
  });

  test('Duplicate entity creation is idempotent', () => {
    store.createEntity({ id: 'test', name: 'Test', type: 'person' });
    store.createEntity({ id: 'test', name: 'Test', type: 'person' });
    const all = store.getAllEntities();
    return all.filter(e => e.id === 'test').length === 1 ? true : 'Duplicate entities created';
  });

  store.close();
}

// Test 7: Importer Quality (on real MEMORY.md)
console.log('\n━━━ 7. Import Quality ━━━');
{
  const store = new MemoryStore(':memory:');
  const importer = new MemoryImporter(store);
  const stats = importer.importMemoryMd('/home/clawdia/.openclaw/workspace/MEMORY.md');
  
  test('Importer creates memories from MEMORY.md', () => {
    if (stats.memoriesCreated === 0) return 'No memories created from MEMORY.md';
    return true;
  });

  test('Not everything is classified as "fact"', () => {
    const all = store.getAllMemories(200);
    const facts = all.filter(m => m.category === 'fact');
    const factPct = facts.length / all.length;
    if (factPct > 0.8) return `${Math.round(factPct * 100)}% are facts — classifier may be too conservative`;
    return true;
  });

  test('Entities are extracted from MEMORY.md', () => {
    const all = store.getAllMemories(200);
    const withEntities = all.filter(m => m.entities.length > 0);
    if (withEntities.length === 0) return 'No memories have entities';
    const pct = withEntities.length / all.length;
    if (pct < 0.3) warn(`Only ${Math.round(pct * 100)}% of memories have entities`);
    return true;
  });

  const all = store.getAllMemories(200);
  const typeDist: Record<string, number> = {};
  for (const m of all) typeDist[m.attribution.type] = (typeDist[m.attribution.type] ?? 0) + 1;
  console.log(`  Import results: ${stats.memoriesCreated} memories, types: ${JSON.stringify(typeDist)}`);

  store.close();
}

// ============================================================
// Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (warnings.length > 0) {
  console.log('⚠️  Warnings:');
  for (const w of warnings) console.log(`   - ${w}`);
  console.log('');
}

if (failed > 0) {
  console.log('❌ Some tests failed. Fix these before relying on agent-memory for session startup.');
} else if (warnings.length > 0) {
  console.log('✅ All tests passed, but review the warnings above.');
  console.log('   The system works but has room for improvement.');
} else {
  console.log('✅ All tests passed. Agent-memory is ready for production use.');
}

process.exit(failed > 0 ? 1 : 0);
