/// <reference lib="deno.unstable" />

import type { GameState, SessionData, World } from "../types.ts";
import type { ISessionManager } from "./interface.ts";

/**
 * Session management using Deno KV
 */
export class KvSessionManager implements ISessionManager {
  private kv: Deno.Kv | null = null;

  async init(): Promise<void> {
    this.kv = await Deno.openKv();
  }

  close(): void {
    if (this.kv) {
      this.kv.close();
    }
  }

  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  private async saveSession(sessionData: SessionData): Promise<void> {
    if (!this.kv) throw new Error("KV store not initialized");

    // Update last activity timestamp
    sessionData.lastActivity = Date.now();

    // Store with a 24-hour expiry
    const expireIn = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    await this.kv.set(
      ["sessions", sessionData.sessionId],
      sessionData,
      { expireIn },
    );
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    if (!this.kv) throw new Error("KV store not initialized");

    const entry = await this.kv.get<SessionData>(["sessions", sessionId]);

    if (!entry.value) {
      return null;
    }

    // Check if session is expired (older than 24 hours)
    const now = Date.now();
    const sessionAge = now - entry.value.lastActivity;
    if (sessionAge > 24 * 60 * 60 * 1000) {
      // Clean up expired session
      await this.deleteSession(sessionId);
      return null;
    }

    return entry.value;
  }

  async createSession(worldDescription: string): Promise<SessionData> {
    const sessionId = this.generateSessionId();
    const sessionData: SessionData = {
      sessionId,
      worldDescription,
      generatedWorld: null,
      openingScene: null,
      currentGameState: null,
      currentTurn: 0,
      lastActivity: Date.now(),
    };

    await this.saveSession(sessionData);
    return sessionData;
  }

  async updateWorld(sessionId: string, world: World): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    session.generatedWorld = world;
    await this.saveSession(session);
    return true;
  }

  async updateOpeningScene(
    sessionId: string,
    scene: string,
  ): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    session.openingScene = scene;
    await this.saveSession(session);
    return true;
  }

  async updateGameState(
    sessionId: string,
    gameState: GameState,
  ): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    session.currentGameState = gameState;
    session.currentTurn = gameState.currentTurn;
    await this.saveSession(session);
    return true;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.kv) throw new Error("KV store not initialized");
    await this.kv.delete(["sessions", sessionId]);
  }

  async cleanupOldSessions(): Promise<number> {
    if (!this.kv) throw new Error("KV store not initialized");

    let deletedCount = 0;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    const iter = this.kv.list<SessionData>({ prefix: ["sessions"] });

    for await (const entry of iter) {
      if (entry.value) {
        const sessionAge = now - entry.value.lastActivity;
        if (sessionAge > maxAge) {
          await this.kv.delete(entry.key);
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }
}

// Global session manager instance
let sessionManager: KvSessionManager | null = null;

export async function getSessionManager(): Promise<KvSessionManager> {
  if (!sessionManager) {
    sessionManager = new KvSessionManager();
    await sessionManager.init();
  }
  return sessionManager;
}
