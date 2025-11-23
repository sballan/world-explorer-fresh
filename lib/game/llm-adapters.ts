import type { Action, Entity, World } from "./types.ts";
import type {
  IActionSelector,
  IDiscoveryGenerator,
  INarrator,
  IWorldGenerator,
  Message,
} from "./llm-interfaces.ts";
import {
  generateDiscovery as llmGenerateDiscovery,
  generateOpeningScene as llmGenerateOpeningScene,
  generateWorld as llmGenerateWorld,
  narrateAction as llmNarrateAction,
  selectInterestingActions as llmSelectInterestingActions,
} from "./llm.ts";

/**
 * Default adapter for world generation using the real LLM
 */
export class LLMWorldGenerator implements IWorldGenerator {
  async generateWorld(worldDescription: string): Promise<World | null> {
    return await llmGenerateWorld(worldDescription);
  }

  async generateOpeningScene(
    world: World,
    messageHistory: Message[],
  ): Promise<string> {
    return await llmGenerateOpeningScene(world, messageHistory);
  }
}

/**
 * Default adapter for action narration using the real LLM
 */
export class LLMNarrator implements INarrator {
  async narrateAction(
    action: Action,
    changes: string[],
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<string> {
    return await llmNarrateAction(
      action,
      changes,
      world,
      playerId,
      messageHistory,
    );
  }
}

/**
 * Default adapter for action selection using the real LLM
 */
export class LLMActionSelector implements IActionSelector {
  async selectInterestingActions(
    actions: Action[],
    world: World,
    playerId: string,
    messageHistory: Message[],
    maxActions: number = 9,
  ): Promise<Action[]> {
    return await llmSelectInterestingActions(
      actions,
      world,
      playerId,
      messageHistory,
      maxActions,
    );
  }
}

/**
 * Default adapter for discovery generation using the real LLM
 */
export class LLMDiscoveryGenerator implements IDiscoveryGenerator {
  async generateDiscovery(
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<Entity | null> {
    return await llmGenerateDiscovery(world, playerId, messageHistory);
  }
}
