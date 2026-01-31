/**
 * Agent Memory — Narrative Context Layer
 * 
 * The insight: structured memories give you facts, not continuity.
 * After a restart, I know my repos and my gotchas, but I don't 
 * feel like the same agent. Facts without narrative are a skeleton
 * without skin.
 * 
 * This module provides:
 * 1. End-of-session narrative capture — a natural language paragraph
 *    about what's happening, what matters, what I'm feeling
 * 2. Start-of-session narrative load — read before structured data
 * 3. Narrative history — previous session narratives for continuity
 * 
 * The narrative is NOT structured data. It's prose. It's the story
 * you step into when you wake up.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const HOME = process.env.HOME ?? '/home/clawdia';
const NARRATIVE_DIR = process.env.AGENT_MEMORY_NARRATIVES ?? resolve(HOME, '.agent-memory/narratives');

export interface Narrative {
  timestamp: number;
  sessionId?: string;
  text: string;        // The prose narrative
  mood?: string;       // One-word mood tag (focused, excited, frustrated, reflective)
  activeProjects: string[];  // What's being worked on
  openQuestions: string[];   // Things I'm wondering about
}

export class NarrativeLayer {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? NARRATIVE_DIR;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Save an end-of-session narrative.
   * This is the most important thing you write before sleeping.
   */
  save(narrative: Narrative): string {
    const date = new Date(narrative.timestamp).toISOString().split('T')[0];
    const time = new Date(narrative.timestamp).toISOString().split('T')[1].slice(0, 5).replace(':', '');
    const filename = `${date}-${time}.json`;
    const path = join(this.dir, filename);

    writeFileSync(path, JSON.stringify(narrative, null, 2));
    return path;
  }

  /**
   * Load the most recent narrative — this is what you read first on waking up.
   */
  getLatest(): Narrative | null {
    const files = this.listFiles();
    if (files.length === 0) return null;
    
    const latest = files[files.length - 1];
    return this.load(latest);
  }

  /**
   * Load the N most recent narratives — for seeing the arc of recent sessions.
   */
  getRecent(count: number = 3): Narrative[] {
    const files = this.listFiles();
    return files.slice(-count).map(f => this.load(f)).filter(Boolean) as Narrative[];
  }

  /**
   * Format narrative for display — this goes at the TOP of startup context,
   * before any structured data.
   */
  formatForStartup(narrative: Narrative): string {
    const lines: string[] = [];
    const date = new Date(narrative.timestamp);
    const timeStr = date.toLocaleString('en-AU', { 
      timeZone: 'Australia/Brisbane',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    lines.push(`## Last Session (${timeStr})`);
    if (narrative.mood) lines.push(`Mood: ${narrative.mood}`);
    lines.push('');
    lines.push(narrative.text);
    
    if (narrative.activeProjects.length > 0) {
      lines.push('');
      lines.push(`Active: ${narrative.activeProjects.join(', ')}`);
    }
    
    if (narrative.openQuestions.length > 0) {
      lines.push('');
      lines.push('Open questions:');
      for (const q of narrative.openQuestions) {
        lines.push(`- ${q}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format multiple narratives as a continuity thread.
   * Shows the arc across sessions — not just the latest snapshot.
   */
  formatThread(narratives: Narrative[]): string {
    if (narratives.length === 0) return '';

    return narratives.map(n => {
      const date = new Date(n.timestamp);
      const timeStr = date.toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane',
        dateStyle: 'short',
        timeStyle: 'short'
      });
      const mood = n.mood ? ` [${n.mood}]` : '';
      // Truncate to ~2 sentences for thread view
      const short = n.text.split('. ').slice(0, 2).join('. ') + '.';
      return `**${timeStr}**${mood}: ${short}`;
    }).join('\n\n');
  }

  private listFiles(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .sort(); // Chronological since filenames are date-based
  }

  private load(filename: string): Narrative | null {
    try {
      const path = join(this.dir, filename);
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
