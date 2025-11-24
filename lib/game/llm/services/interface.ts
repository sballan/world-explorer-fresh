import type { Action, Entity, World } from "../../types.ts";

/**
 * Message for LLM conversations
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Interface for world generation services
 */
export interface IWorldGenerator {
  /**
   * Generate a complete game world from a description
   */
  generateWorld(worldDescription: string): Promise<World | null>;

  /**
   * Generate an opening scene for a world
   */
  generateOpeningScene(
    world: World,
    messageHistory: Message[],
  ): Promise<string>;
}

/**
 * Interface for action narration services
 */
export interface INarrator {
  /**
   * Generate narrative text for an action that was performed
   */
  narrateAction(
    action: Action,
    changes: string[],
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<string>;
}

/**
 * Interface for action selection services
 */
export interface IActionSelector {
  /**
   * Select the most interesting actions from a list
   */
  selectInterestingActions(
    actions: Action[],
    world: World,
    playerId: string,
    messageHistory: Message[],
    maxActions?: number,
  ): Promise<Action[]>;
}

/**
 * Interface for discovery generation services
 */
export interface IDiscoveryGenerator {
  /**
   * Generate a discovery during exploration
   */
  generateDiscovery(
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<Entity | null>;
}
