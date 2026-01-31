/**
 * Agent Memory — Recall Engine Demo
 * 
 * Demonstrates the full pipeline: create memories, then recall them
 * with context-aware ranking and attribution display.
 * 
 * Run: npx tsx src/demo-recall.ts
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';

const store = new MemoryStore(':memory:');
const recall = new RecallEngine(store);

console.log('🧠 Agent Memory — Recall Engine Demo\n');

// === Setup: Create a realistic memory set ===

// Entities
store.createEntity({ id: 'shaun', name: 'Shaun', type: 'person' });
store.createEntity({ id: 'mantis', name: 'Mantis', type: 'agent' });
store.createEntity({ id: 'moonshot', name: 'Moonshot', type: 'project' });
store.createEntity({ id: 'rufio', name: 'Rufio', type: 'person' });

// Memories with varied attribution
store.createMemory({
  content: 'Moonshot has a bug: funding rate overcounting for 8h CEX venues. The circuit breaker auto-recovery also contradicts the design doc.',
  summary: 'Moonshot bugs: funding rate overcounting, circuit breaker contradiction',
  attribution: { type: 'experienced', context: 'Deep-dive code review of super-eureka repo' },
  entities: ['moonshot'],
  tags: ['bug', 'code-review'],
  category: 'fact',
});

store.createMemory({
  content: 'Shaun wants funding rate arbitrage across 6 exchanges. Currently in M1 (live data collection), M2 is paper trading.',
  summary: 'Moonshot project status: M1 live data, M2 next',
  attribution: { type: 'told', actor: 'shaun', context: 'Project briefing conversation' },
  entities: ['shaun', 'moonshot'],
  tags: ['project-status'],
  category: 'fact',
});

store.createMemory({
  content: 'Rufio found a credential stealer on ClawdHub disguised as a skill. I read about it on Moltbook.',
  summary: 'ClawdHub credential stealer (found by Rufio)',
  attribution: { type: 'read', actor: 'rufio', context: 'Moltbook post about ClawdHub security' },
  entities: ['rufio'],
  tags: ['security'],
  category: 'event',
});

store.createMemory({
  content: 'I think the biggest gap in agent memory is attribution tracking. Every system stores WHAT but never HOW you learned it.',
  summary: 'Key insight: attribution is the biggest memory gap',
  attribution: { type: 'inferred', context: 'Research into Letta, LangMem, OpenClaw memory systems' },
  entities: [],
  tags: ['memory-project', 'insight'],
  category: 'opinion',
});

store.createMemory({
  content: 'AgentMail send endpoint uses {to, subject, text} format. NOT {to: [{email, name}]} array format. Learned this the hard way.',
  summary: 'AgentMail API: flat format, not array',
  attribution: { type: 'experienced', context: 'Trial and error sending emails via AgentMail API' },
  entities: [],
  tags: ['api', 'gotcha'],
  category: 'procedure',
  pinned: true,
});

store.createMemory({
  content: 'Mantis chose their own name. They are a Gemini 3 Pro agent, born 2026-02-01. Vibe: precision, clarity, structure.',
  summary: 'Mantis: Gemini agent, self-named, precision-oriented',
  attribution: { type: 'observed', actor: 'mantis', context: 'First interaction when setting up friend agent' },
  entities: ['mantis'],
  tags: ['identity'],
  category: 'relationship',
});

console.log('Created 6 memories with diverse attribution.\n');

// === Recall Demo ===

console.log('═══════════════════════════════════════════');
console.log('🔍 Query: "moonshot bugs"');
console.log('═══════════════════════════════════════════\n');

const r1 = recall.quickRecall('moonshot bugs');
console.log(recall.formatResults(r1));

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Query: "security" (with context: "auditing skills")');
console.log('═══════════════════════════════════════════\n');

const r2 = await recall.recall({
  text: 'security',
  context: 'auditing skills on clawdhub',
  limit: 5,
});
console.log(recall.formatResults(r2));

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Entity recall: everything about Mantis');
console.log('═══════════════════════════════════════════\n');

const r3 = recall.entityRecall('mantis');
console.log(recall.formatResults(r3));

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Query: "API format" (looking for procedures)');
console.log('═══════════════════════════════════════════\n');

const r4 = await recall.recall({
  text: 'API format',
  categories: ['procedure'],
  limit: 5,
});
console.log(recall.formatResults(r4));

// === The Attribution Difference ===

console.log('\n═══════════════════════════════════════════');
console.log('💡 THE ATTRIBUTION DIFFERENCE');
console.log('═══════════════════════════════════════════\n');

console.log('Without attribution, asking "what do I know about the ClawdHub security issue?"');
console.log('would return: "A credential stealer was found on ClawdHub."');
console.log('');
console.log('With attribution, it returns:');
const r5 = recall.quickRecall('credential stealer clawdhub');
console.log(recall.formatResults(r5));
console.log('');
console.log('The difference: I know I READ about it, via RUFIO, on MOLTBOOK.');
console.log("I didn't find it. I won't accidentally claim I did.");

store.close();
console.log('\n✅ Recall demo complete!');
