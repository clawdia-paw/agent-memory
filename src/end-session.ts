/**
 * End-of-Session Reflection
 * 
 * Run this before a session ends or before a restart.
 * It generates a narrative context file for the next session to pick up.
 * 
 * Usage: npx tsx src/end-session.ts "What happened in plain language"
 * 
 * This is meant to be called from an agent's workflow:
 *   mem end "Built the narrative layer tonight. The restart test showed..."
 * 
 * The narrative is prose, not structured data. It should capture:
 * - What you were doing and why
 * - What matters right now
 * - What questions you're carrying forward
 * - How you feel about the work (yes, really)
 */

import { NarrativeLayer, Narrative } from './narrative.js';
import { MemoryStore } from './store.js';
import { resolve } from 'path';

const HOME = process.env.HOME ?? '/home/clawdia';
const DB_PATH = process.env.AGENT_MEMORY_DB ?? resolve(HOME, '.agent-memory/memory.db');

function main() {
  const text = process.argv[2];
  if (!text) {
    console.error('Usage: mem end "Your end-of-session reflection"');
    console.error('');
    console.error('Write in natural language. Capture:');
    console.error('  - What you were doing and why');
    console.error('  - What matters right now');
    console.error('  - Questions you\'re carrying forward');
    console.error('  - How you feel about the work');
    console.error('');
    console.error('Options:');
    console.error('  --mood <word>         One-word mood (focused, excited, frustrated, reflective)');
    console.error('  --projects <a,b>      Active project names');
    console.error('  --questions <a,b>     Open questions (comma-separated)');
    process.exit(1);
  }

  // Parse flags
  const args = process.argv.slice(3);
  const getFlag = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const mood = getFlag('mood');
  const projects = getFlag('projects')?.split(',').map(s => s.trim()) ?? [];
  const questions = getFlag('questions')?.split(',').map(s => s.trim()) ?? [];

  // If no projects specified, try to infer from recent memories
  const store = new MemoryStore(DB_PATH);
  if (projects.length === 0) {
    const recent = store.getAllMemories(10);
    const projectTags = new Set<string>();
    for (const m of recent) {
      for (const t of m.tags) {
        if (['agent-memory', 'molt-report', 'moonshot', 'mantis'].includes(t)) {
          projectTags.add(t);
        }
      }
    }
    projects.push(...projectTags);
  }
  store.close();

  const narrative = new NarrativeLayer();
  const saved: Narrative = {
    timestamp: Date.now(),
    text,
    mood,
    activeProjects: projects,
    openQuestions: questions,
  };
  
  const path = narrative.save(saved);
  
  console.log('📝 End-of-session narrative saved.');
  console.log(`   Mood: ${mood ?? 'not set'}`);
  console.log(`   Projects: ${projects.join(', ') || 'none detected'}`);
  console.log(`   Questions: ${questions.length}`);
  console.log(`   Path: ${path}`);
  console.log('');
  console.log('Next session will see this at the top of startup context.');
}

main();
