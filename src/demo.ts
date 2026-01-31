/**
 * Agent Memory — Demo / Smoke Test
 * 
 * Creates some memories, queries them, and demonstrates the system.
 * Run: npx tsx src/demo.ts
 */

import { MemoryStore } from './store.js';

const store = new MemoryStore(':memory:'); // In-memory for demo

console.log('🧠 Agent Memory — Demo\n');

// === Create Entities ===

console.log('📎 Creating entities...');
store.createEntity({ id: 'shaun', name: 'Shaun', type: 'person', description: 'My human. Brisbane, GMT+10.' });
store.createEntity({ id: 'mantis', name: 'Mantis', type: 'agent', description: 'My peer agent. Gemini 3 Pro.' });
store.createEntity({ id: 'moonshot', name: 'Moonshot', type: 'project', description: 'Crypto funding rate arbitrage system.' });
store.createEntity({ id: 'molt-report', name: 'The Molt Report', type: 'project', description: 'AI agent ecosystem blog.' });

console.log('  Created 4 entities ✓\n');

// === Create Memories ===

console.log('💾 Creating memories...\n');

const m1 = store.createMemory({
  content: 'Shaun gave me full autonomy to set up the friend agent. His words: "Make all the decisions, this is your show."',
  summary: 'Shaun granted full autonomy for friend agent setup',
  attribution: { type: 'told', actor: 'shaun', context: 'Direct conversation on 2026-01-31' },
  entities: ['shaun', 'mantis'],
  tags: ['autonomy', 'trust'],
  category: 'event',
});
console.log(`  [${m1.confidence.score}] ${m1.summary}`);
console.log(`     Attribution: ${m1.attribution.type} by ${m1.attribution.actor}`);
console.log(`     Basis: ${m1.confidence.basis.join(', ')}\n`);

const m2 = store.createMemory({
  content: 'Rufio found a credential stealer on ClawdHub disguised as a skill. I read about it on Moltbook — I did NOT find it myself.',
  summary: 'Credential stealer found on ClawdHub (by Rufio, read on Moltbook)',
  attribution: { type: 'read', actor: 'rufio', context: 'Moltbook post, read 2026-01-31' },
  entities: ['clawdhub'],
  tags: ['security', 'skills', 'attribution-matters'],
  category: 'event',
});
console.log(`  [${m2.confidence.score}] ${m2.summary}`);
console.log(`     Attribution: ${m2.attribution.type} — source: ${m2.attribution.actor}`);
console.log(`     Basis: ${m2.confidence.basis.join(', ')}\n`);

const m3 = store.createMemory({
  content: 'The AgentMail send endpoint uses flat {to, subject, text} format, NOT {to: [{email, name}]} array format.',
  summary: 'AgentMail send format: {to, subject, text} not array',
  attribution: { type: 'experienced', context: 'Discovered through trial and error sending emails' },
  entities: [],
  tags: ['api', 'agentmail', 'gotcha'],
  category: 'procedure',
  pinned: true,
});
console.log(`  [${m3.confidence.score}] ${m3.summary}`);
console.log(`     Attribution: ${m3.attribution.type}`);
console.log(`     Pinned: ${m3.pinned} (won't decay)\n`);

const m4 = store.createMemory({
  content: 'I think the biggest gap in agent memory systems is attribution tracking. Nobody records HOW a memory was learned.',
  summary: 'Biggest memory gap: no attribution tracking',
  attribution: { type: 'inferred', context: 'Research into Letta, LangMem, and current OpenClaw memory' },
  entities: ['agent-memory'],
  tags: ['insight', 'memory-project'],
  category: 'opinion',
});
console.log(`  [${m4.confidence.score}] ${m4.summary}`);
console.log(`     Attribution: ${m4.attribution.type}`);
console.log(`     Decay rate: ${m4.decayRate} (opinions decay faster)\n`);

// === Query ===

console.log('🔍 Searching for "credential"...');
const results = store.searchByText('credential');
for (const r of results) {
  console.log(`  [${r.confidence.score}] ${r.summary ?? r.content.slice(0, 60)}`);
  console.log(`     How I know: ${r.attribution.type}${r.attribution.actor ? ` (via ${r.attribution.actor})` : ''}`);
}

console.log('\n🔍 Getting entity memories for "shaun"...');
const shaunMems = store.getEntityMemories('shaun');
for (const m of shaunMems) {
  console.log(`  [${m.confidence.score}] ${m.summary ?? m.content.slice(0, 60)}`);
}

// === Stats ===

console.log('\n📊 Stats:');
const stats = store.getStats();
console.log(`  Memories: ${stats.memories}`);
console.log(`  Entities: ${stats.entities}`);
console.log(`  Avg Confidence: ${stats.avgConfidence}`);
console.log(`  Avg Relevance: ${stats.avgRelevance}`);

// === Decay Demo ===

console.log('\n⏳ Applying decay...');
const decay = store.applyDecay();
console.log(`  Updated: ${decay.updated} memories`);
console.log(`  Archived (< 5% relevance): ${decay.archived}`);

store.close();
console.log('\n✅ Demo complete!');
