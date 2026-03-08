import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { mkdirSync } from 'fs';
import { config } from '../config.js';
import { gracefulKill, type CliProcessHandle } from './cli-process.js';
import type { SessionResponse } from '../types/api.js';

const DB_DIR = path.join(process.env.HOME || '/home/node', '.claude');
const DB_PATH = path.join(DB_DIR, 'cli2agent.db');

export class SessionManager {
  private db: Database.Database;
  /** Active CLI processes indexed by session ID */
  private activeProcesses = new Map<string, CliProcessHandle>();
  /** Per-session locks to prevent concurrent execution */
  private locks = new Set<string>();

  constructor() {
    mkdirSync(DB_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                  TEXT PRIMARY KEY,
        workspace           TEXT NOT NULL,
        name                TEXT,
        status              TEXT NOT NULL DEFAULT 'idle',
        model               TEXT,
        message_count       INTEGER DEFAULT 0,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        total_input_tokens  INTEGER DEFAULT 0,
        total_output_tokens INTEGER DEFAULT 0
      )
    `);
  }

  /** Create a new session (no CLI process spawned yet) */
  create(options: { workspace?: string; name?: string; model?: string } = {}): SessionResponse {
    const id = uuidv4();
    const now = new Date().toISOString();
    const workspace = options.workspace || config.workspace;

    this.db.prepare(`
      INSERT INTO sessions (id, workspace, name, model, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'idle', ?, ?)
    `).run(id, workspace, options.name || null, options.model || null, now, now);

    return this.get(id)!;
  }

  /** Get a session by ID */
  get(id: string): SessionResponse | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;

    // Overlay runtime status from active processes
    const isActive = this.activeProcesses.has(id);
    return {
      ...rowToResponse(row),
      status: isActive ? 'active' : row.status as SessionResponse['status'],
    };
  }

  /** List sessions with optional filters */
  list(filters: { status?: string; workspace?: string; limit?: number; offset?: number } = {}): {
    sessions: SessionResponse[];
    total: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.workspace) {
      conditions.push('workspace = ?');
      params.push(filters.workspace);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM sessions ${where}`).get(...params) as { count: number }).count;

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const rows = this.db.prepare(
      `SELECT * FROM sessions ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as SessionRow[];

    let sessions = rows.map(rowToResponse);

    // Filter by runtime status if requested
    if (filters.status === 'active') {
      sessions = sessions.filter((s) => this.activeProcesses.has(s.id));
    } else if (filters.status === 'idle') {
      sessions = sessions.filter((s) => !this.activeProcesses.has(s.id) && s.status !== 'errored');
    }

    // Overlay runtime active status
    sessions = sessions.map((s) => ({
      ...s,
      status: this.activeProcesses.has(s.id) ? 'active' as const : s.status,
    }));

    return { sessions, total };
  }

  /** Delete a session and clean up resources */
  async delete(id: string, force = false): Promise<boolean> {
    const session = this.get(id);
    if (!session) return false;

    // Kill active process if any
    const handle = this.activeProcesses.get(id);
    if (handle) {
      if (!force && session.status === 'active') {
        throw new Error('Session is active. Use force=true to delete.');
      }
      await gracefulKill(handle);
      this.activeProcesses.delete(id);
      this.locks.delete(id);
    }

    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return true;
  }

  /** Register an active CLI process for a session */
  registerProcess(sessionId: string, handle: CliProcessHandle): void {
    this.activeProcesses.set(sessionId, handle);
    this.updateStatus(sessionId, 'active');
  }

  /** Unregister a CLI process (on completion or error) */
  unregisterProcess(sessionId: string): void {
    this.activeProcesses.delete(sessionId);
    this.locks.delete(sessionId);
  }

  /** Mark session as completed (idle) with updated stats */
  markCompleted(sessionId: string, usage?: { input_tokens: number; output_tokens: number }): void {
    this.unregisterProcess(sessionId);
    const now = new Date().toISOString();

    if (usage) {
      this.db.prepare(`
        UPDATE sessions
        SET status = 'idle', updated_at = ?,
            message_count = message_count + 1,
            total_input_tokens = total_input_tokens + ?,
            total_output_tokens = total_output_tokens + ?
        WHERE id = ?
      `).run(now, usage.input_tokens, usage.output_tokens, sessionId);
    } else {
      this.db.prepare(`
        UPDATE sessions
        SET status = 'idle', updated_at = ?, message_count = message_count + 1
        WHERE id = ?
      `).run(now, sessionId);
    }
  }

  /** Mark session as errored */
  markErrored(sessionId: string): void {
    this.unregisterProcess(sessionId);
    this.updateStatus(sessionId, 'errored');
  }

  /** Try to acquire a lock for a session. Returns false if already locked. */
  tryLock(sessionId: string): boolean {
    if (this.locks.has(sessionId)) return false;
    this.locks.add(sessionId);
    return true;
  }

  /** Release a session lock */
  releaseLock(sessionId: string): void {
    this.locks.delete(sessionId);
  }

  /** Get or create a session for the given ID */
  getOrCreate(sessionId: string | undefined): SessionResponse {
    if (sessionId) {
      const existing = this.get(sessionId);
      if (existing) return existing;
    }
    return this.create();
  }

  /** Get the active process handle for a session */
  getProcess(sessionId: string): CliProcessHandle | undefined {
    return this.activeProcesses.get(sessionId);
  }

  /** Shutdown: kill all active processes */
  async shutdown(): Promise<void> {
    const kills = [...this.activeProcesses.entries()].map(async ([id, handle]) => {
      await gracefulKill(handle);
      this.activeProcesses.delete(id);
    });
    await Promise.all(kills);
    this.db.close();
  }

  private updateStatus(id: string, status: string): void {
    this.db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }
}

interface SessionRow {
  id: string;
  workspace: string;
  name: string | null;
  status: string;
  model: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  total_input_tokens: number;
  total_output_tokens: number;
}

function rowToResponse(row: SessionRow): SessionResponse {
  return {
    id: row.id,
    status: row.status as SessionResponse['status'],
    workspace: row.workspace,
    name: row.name,
    model: row.model,
    message_count: row.message_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    total_input_tokens: row.total_input_tokens,
    total_output_tokens: row.total_output_tokens,
  };
}
