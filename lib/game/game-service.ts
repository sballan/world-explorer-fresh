import { ActionEngine } from "./engine.ts";
import type {
  IActionSelector,
  IDiscoveryGenerator,
  INarrator,
  IWorldGenerator,
  Message,
} from "./llm/services/interface.ts";
import {
  LLMActionSelector,
  LLMDiscoveryGenerator,
  LLMNarrator,
  LLMWorldGenerator,
} from "./llm/services/index.ts";
import type { ISessionManager } from "./session/interface.ts";
import type { Action, Entity, GameState, World } from "./types.ts";
import { validateWorld } from "./validation.ts";

/**
 * Result of initializing a new game
 */
export interface GameInitResult {
  sessionId: string;
  world: World;
  openingScene: string;
  availableCharacters: Entity[];
}

/**
 * Result of selecting a character
 */
export interface CharacterSelectResult {
  success: true;
  character: Entity;
  gameState: {
    currentLocation: string;
    health: number;
    energy: number;
    inventory: string[];
  };
  availableActions: Action[];
}

/**
 * Result of performing an action
 */
export interface GameActionResult {
  success: boolean;
  narration: string;
  gameState: {
    currentLocation: string;
    health: number;
    energy: number;
    inventory: string[];
  };
  availableActions: Action[];
  discovery?: Entity;
  gameOver: boolean;
  gameOverReason?: string;
}

/**
 * Result of checking game status
 */
export interface GameStatusResult {
  status: "not_initialized" | "character_selection" | "active";
  sessionId: string;
  worldDescription?: string;
  world?: World;
  openingScene?: string;
  availableCharacters?: Entity[];
  currentTurn?: number;
  playerState?: {
    currentLocation: string;
    health: number;
    energy: number;
    inventory: string[];
  };
  availableActions?: Action[];
  worldName?: string;
  currentLocation?: Entity;
}

/**
 * Core game service that orchestrates all game operations
 * Extracts business logic from route handlers for testability
 *
 * Uses dependency injection to allow mocking of LLM services in tests
 */
export class GameService {
  constructor(
    private sessionManager: ISessionManager,
    private worldGenerator: IWorldGenerator = new LLMWorldGenerator(),
    private narrator: INarrator = new LLMNarrator(),
    private actionSelector: IActionSelector = new LLMActionSelector(),
    private discoveryGenerator: IDiscoveryGenerator =
      new LLMDiscoveryGenerator(),
  ) {}

  /**
   * Initialize a new game world
   */
  async initializeGame(worldDescription: string): Promise<GameInitResult> {
    // Create a new session
    const session = await this.sessionManager.createSession(worldDescription);

    // Generate world with retry logic
    let world: World | null = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (!world && attempts < maxAttempts) {
      attempts++;
      console.log(`Generating world (attempt ${attempts}/${maxAttempts})...`);

      const generatedWorld = await this.worldGenerator.generateWorld(
        worldDescription,
      );

      if (generatedWorld) {
        const validation = validateWorld(generatedWorld);

        if (validation.valid) {
          world = generatedWorld;
        } else {
          console.log("World validation failed:", validation.errors);
          if (attempts === maxAttempts) {
            throw new Error(
              "Failed to generate a valid world after multiple attempts",
            );
          }
        }
      }
    }

    if (!world) {
      throw new Error("Unable to generate world");
    }

    // Save world to session
    await this.sessionManager.updateWorld(session.sessionId, world);

    // Generate opening scene
    const messageHistory: Message[] = [
      {
        role: "system",
        content:
          `You are the narrator for an interactive text adventure game set in: ${world.world_description}`,
      },
    ];

    const openingScene = await this.worldGenerator.generateOpeningScene(
      world,
      messageHistory,
    );

    // Save opening scene
    await this.sessionManager.updateOpeningScene(
      session.sessionId,
      openingScene,
    );

    // Get available characters (people at starting location)
    const availableCharacters = world.entities.filter(
      (e) => e.type === "person" && e.location === world.starting_location,
    );

    return {
      sessionId: session.sessionId,
      world,
      openingScene,
      availableCharacters,
    };
  }

  /**
   * Select a character to play as
   */
  async selectCharacter(
    sessionId: string,
    characterId: string,
  ): Promise<CharacterSelectResult> {
    // Get session
    const session = await this.sessionManager.getSession(sessionId);

    if (!session || !session.generatedWorld) {
      throw new Error("Invalid session or world not generated");
    }

    const world = session.generatedWorld;

    // Verify character exists and is at starting location
    const character = world.entities.find(
      (e) =>
        e.id === characterId &&
        e.type === "person" &&
        e.location === world.starting_location,
    );

    if (!character) {
      throw new Error("Invalid character selection");
    }

    // Initialize game state
    const messageHistory: Message[] = [
      {
        role: "system",
        content:
          `You are the narrator for an interactive text adventure game set in: ${world.world_description}`,
      },
    ];

    if (session.openingScene) {
      messageHistory.push({
        role: "assistant",
        content: session.openingScene,
      });
    }

    const gameState: GameState = {
      world,
      playerId: characterId,
      currentTurn: 1,
      messageHistory,
    };

    // Save game state
    await this.sessionManager.updateGameState(sessionId, gameState);

    // Generate initial actions
    const engine = new ActionEngine(world);
    const allActions = engine.generateValidActions(characterId);
    const availableActions = await this.actionSelector.selectInterestingActions(
      allActions,
      world,
      characterId,
      messageHistory,
    );

    const playerState = engine.getPlayerState(characterId);

    if (!playerState) {
      throw new Error("Failed to get player state");
    }

    return {
      success: true,
      character,
      gameState: playerState,
      availableActions,
    };
  }

  /**
   * Perform a game action
   */
  async performAction(
    sessionId: string,
    action: Action,
  ): Promise<GameActionResult> {
    // Get session and game state
    const session = await this.sessionManager.getSession(sessionId);

    if (!session || !session.currentGameState) {
      throw new Error("No active game found");
    }

    const gameState = session.currentGameState;
    const world = gameState.world;
    const playerId = gameState.playerId;

    // Execute the action with transaction support
    const engine = new ActionEngine(world);
    const result = engine.executeAction(
      playerId,
      action,
      gameState.currentTurn,
    );

    // Use the new world from the transaction result
    let updatedWorld = result.world;
    const changes = [...result.changes];

    // Handle EXPLORE action - generate discovery
    let discovery: Entity | undefined;
    if (action.type === "EXPLORE") {
      const generatedDiscovery = await this.discoveryGenerator
        .generateDiscovery(
          updatedWorld,
          playerId,
          gameState.messageHistory,
        );

      if (generatedDiscovery) {
        // Add the discovery to the world (create new reference)
        updatedWorld = {
          ...updatedWorld,
          entities: [...updatedWorld.entities, generatedDiscovery],
        };

        // If it's a new place, update connections
        if (generatedDiscovery.type === "place") {
          const player = updatedWorld.entities.find((e) => e.id === playerId)!;
          const currentLocation = updatedWorld.entities.find(
            (e) => e.id === player.location,
          )!;
          if (currentLocation.connections) {
            currentLocation.connections[generatedDiscovery.id] = {};
          }
        }

        // Add discovery text to changes
        if (generatedDiscovery.type === "place") {
          changes.push(
            `You discovered a new location: ${generatedDiscovery.name}!`,
          );
        } else if (generatedDiscovery.type === "item") {
          changes.push(`You found ${generatedDiscovery.name}!`);
        } else if (generatedDiscovery.type === "person") {
          changes.push(`You encountered ${generatedDiscovery.name}!`);
        }

        discovery = generatedDiscovery;
      } else {
        changes.push(
          "You search thoroughly but find nothing new this time.",
        );
      }
    }

    // Generate narration
    const narration = await this.narrator.narrateAction(
      action,
      changes,
      updatedWorld,
      playerId,
      gameState.messageHistory,
    );

    // Update message history
    gameState.messageHistory.push(
      { role: "user", content: `Player action: ${action.description}` },
      { role: "assistant", content: narration },
    );

    // Limit message history to prevent context overflow
    if (gameState.messageHistory.length > 20) {
      gameState.messageHistory = [
        gameState.messageHistory[0], // Keep system prompt
        ...gameState.messageHistory.slice(-10), // Keep last 10 messages
      ];
    }

    // Increment turn counter
    gameState.currentTurn++;

    // Update the game state in session with the new world
    gameState.world = updatedWorld;
    await this.sessionManager.updateGameState(sessionId, gameState);

    // Get player state from the updated engine
    const updatedEngine = new ActionEngine(updatedWorld);
    const playerState = updatedEngine.getPlayerState(playerId);

    if (!playerState) {
      throw new Error("Failed to get player state");
    }

    // Check win/lose conditions
    let gameOver = false;
    let gameOverReason: string | undefined;

    if (playerState.health === 0) {
      gameOver = true;
      gameOverReason = "You have died. Your adventure ends here.";
    }

    // Generate new actions if game is not over
    let availableActions: Action[] = [];
    if (!gameOver) {
      const allActions = updatedEngine.generateValidActions(playerId);
      availableActions = await this.actionSelector.selectInterestingActions(
        allActions,
        updatedWorld,
        playerId,
        gameState.messageHistory,
      );
    }

    return {
      success: result.success,
      narration,
      gameState: playerState,
      availableActions,
      discovery,
      gameOver,
      gameOverReason,
    };
  }

  /**
   * Get current game status
   */
  async getStatus(sessionId: string): Promise<GameStatusResult> {
    // Get session
    const session = await this.sessionManager.getSession(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Check if game is initialized
    if (!session.generatedWorld) {
      return {
        status: "not_initialized",
        sessionId,
        worldDescription: session.worldDescription,
      };
    }

    // Check if character is selected
    if (!session.currentGameState) {
      const availableCharacters = session.generatedWorld.entities.filter(
        (e) =>
          e.type === "person" &&
          e.location === session.generatedWorld!.starting_location,
      );

      return {
        status: "character_selection",
        sessionId,
        world: session.generatedWorld,
        openingScene: session.openingScene ?? undefined,
        availableCharacters,
      };
    }

    // Game is active
    const gameState = session.currentGameState;
    const world = gameState.world;
    const playerId = gameState.playerId;

    const engine = new ActionEngine(world);
    const playerState = engine.getPlayerState(playerId);

    if (!playerState) {
      throw new Error("Failed to get player state");
    }

    // Generate available actions
    const allActions = engine.generateValidActions(playerId);
    const availableActions = await this.actionSelector.selectInterestingActions(
      allActions,
      world,
      playerId,
      gameState.messageHistory,
    );

    return {
      status: "active",
      sessionId,
      currentTurn: gameState.currentTurn,
      playerState,
      availableActions,
      worldName: world.world_name,
      currentLocation: engine.getEntity(playerState.currentLocation),
    };
  }
}
