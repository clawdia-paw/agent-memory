/**
 * Agent Memory — Full Integration Demo
 * 
 * Imports real MEMORY.md, runs recall queries, and reflects.
 * 
 * Run: npx tsx src/demo-full.ts
 */

import { MemoryStore } from './store.js';
import { RecallEngine } from './recall.js';
import { MemoryImporter } from './import.js';
import { ReflectEngine } from './reflect.js';
import { existsSync } from 'fs';

const MEMORY_PATH = '/home/clawdia/.openclaw/workspace/MEMORY.md';
const DAILY_LOG_PATH = '/home/clawdia/.openclaw/workspace/memory';

const store = new MemoryStore('/tmp/agent-memory-demo.db');
const recall = new RecallEngine(store);
const importer = new MemoryImporter(store);
const reflect = new ReflectEngine(store, recall);

console.log('🧠 Agent Memory — Full Integration Demo\n');
console.log('═══════════════════════════════════════════');

// === Import ===

console.log('\n📥 Importing MEMORY.md...');
if (existsSync(MEMORY_PATH)) {
  const memStats = importer.importMemoryMd(MEMORY_PATH);
  console.log(`   Files: ${memStats.filesProcessed} | Memories: ${memStats.memoriesCreated} | Skipped: ${memStats.skipped}`);
} else {
  console.log('   MEMORY.md not found, skipping.');
}

console.log('\n📥 Importing daily logs...');
if (existsSync(DAILY_LOG_PATH)) {
  const logStats = importer.importDailyLogs(DAILY_LOG_PATH);
  console.log(`   Files: ${logStats.filesProcessed} | Memories: ${logStats.memoriesCreated} | Skipped: ${logStats.skipped}`);
} else {
  console.log('   Daily log directory not found, skipping.');
}

// === Stats ===

const stats = store.getStats();
console.log(`\n📊 Memory Store Stats:`);
console.log(`   Total memories: ${stats.memories}`);
console.log(`   Total entities: ${stats.entities}`);
console.log(`   Avg confidence: ${stats.avgConfidence}`);
console.log(`   Avg relevance: ${stats.avgRelevance}`);

// === Recall Queries ===

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Recall: "Shaun"');
console.log('═══════════════════════════════════════════\n');
const r1 = await recall.recall({ text: 'Shaun', entities: ['shaun'], limit: 5 });
console.log(recall.formatResults(r1));

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Recall: "API endpoint" (procedures only)');
console.log('═══════════════════════════════════════════\n');
const r2 = await recall.recall({ text: 'API endpoint', categories: ['procedure'], limit: 5 });
console.log(recall.formatResults(r2));

console.log('\n═══════════════════════════════════════════');
console.log('🔍 Recall: "lessons learned"');
console.log('═══════════════════════════════════════════\n');
const r3 = recall.quickRecall('lessons learned mistakes', 5);
console.log(recall.formatResults(r3));

// === Entity Summary ===

console.log('\n═══════════════════════════════════════════');
console.log('📋 Entity Summary: Mantis');
console.log('═══════════════════════════════════════════\n');
console.log(reflect.generateEntitySummary('mantis'));

// === Reflection ===

console.log('\n═══════════════════════════════════════════');
console.log('🔄 Running reflection cycle...');
console.log('═══════════════════════════════════════════\n');
const report = await reflect.reflect();
console.log(ReflectEngine.formatReport(report));

// Cleanup
store.close();
console.log('\n✅ Full integration demo complete!');
