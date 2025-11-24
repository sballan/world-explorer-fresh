import type { GameState, SessionData, World } from "../types.ts";

/**
 * Interface for session management
 * Allows mocking in tests without Deno KV dependency
 */
export interface ISessionManager {
  /**
   * Create a new session
   */
  createSession(worldDescription: string): Promise<SessionData>;

  /**
   * Get session data by ID
   */
  getSession(sessionId: string): Promise<SessionData | null>;

  /**
   * Update the world in a session
   */
  updateWorld(sessionId: string, world: World): Promise<boolean>;

  /**
   * Update the opening scene in a session
   */
  updateOpeningScene(sessionId: string, scene: string): Promise<boolean>;

  /**
   * Update the game state in a session
   */
  updateGameState(sessionId: string, gameState: GameState): Promise<boolean>;
}
