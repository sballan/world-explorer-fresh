/**
 * Comprehensive tests for GameService - demonstrating full testability
 * with dependency injection
 *
 * Run with: deno test lib/game/game-service.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GameService } from "./game-service.ts";
import type {
  IActionSelector,
  IDiscoveryGenerator,
  INarrator,
  IWorldGenerator,
  Message,
} from "./llm/services/interface.ts";
import type { ISessionManager } from "./session/interface.ts";
import type { Action, Entity, GameState, SessionData, World } from "./types.ts";

/**
 * Mock SessionManager for testing (no Deno KV required)
 */
class MockSessionManager implements ISessionManager {
  private sessions = new Map<string, SessionData>();

  generateSessionId(): string {
    return "mock-session-id";
  }

  createSession(worldDescription: string): Promise<SessionData> {
    const session: SessionData = {
      sessionId: this.generateSessionId(),
      worldDescription,
      generatedWorld: null,
      openingScene: null,
      currentGameState: null,
      currentTurn: 0,
      lastActivity: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return Promise.resolve(session);
  }

  getSession(sessionId: string): Promise<SessionData | null> {
    return Promise.resolve(this.sessions.get(sessionId) || null);
  }

  updateWorld(sessionId: string, world: World): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.generatedWorld = world;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  updateOpeningScene(
    sessionId: string,
    openingScene: string,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.openingScene = openingScene;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  updateGameState(
    sessionId: string,
    gameState: GameState,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentGameState = gameState;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/**
 * Mock WorldGenerator (no LLM calls)
 */
class MockWorldGenerator implements IWorldGenerator {
  constructor(private mockWorld: World | null) {}

  generateWorld(_worldDescription: string): Promise<World | null> {
    return Promise.resolve(this.mockWorld);
  }

  generateOpeningScene(
    _world: World,
    _messageHistory: Message[],
  ): Promise<string> {
    return Promise.resolve("Welcome to the test world!");
  }
}

/**
 * Mock Narrator (no LLM calls)
 */
class MockNarrator implements INarrator {
  constructor(private mockNarration: string = "You performed an action.") {}

  narrateAction(
    _action: Action,
    _changes: string[],
    _world: World,
    _playerId: string,
    _messageHistory: Message[],
  ): Promise<string> {
    return Promise.resolve(this.mockNarration);
  }
}

/**
 * Mock ActionSelector (no LLM calls)
 */
class MockActionSelector implements IActionSelector {
  constructor(private mockActions: Action[] = []) {}

  selectInterestingActions(
    actions: Action[],
    _world: World,
    _playerId: string,
    _messageHistory: Message[],
    maxActions?: number,
  ): Promise<Action[]> {
    // Return mock actions if provided, otherwise return first N actions
    if (this.mockActions.length > 0) {
      return Promise.resolve(this.mockActions);
    }
    return Promise.resolve(actions.slice(0, maxActions || 9));
  }
}

/**
 * Mock DiscoveryGenerator (no LLM calls)
 */
class MockDiscoveryGenerator implements IDiscoveryGenerator {
  constructor(private mockDiscovery: Entity | null = null) {}

  generateDiscovery(
    _world: World,
    _playerId: string,
    _messageHistory: Message[],
  ): Promise<Entity | null> {
    return Promise.resolve(this.mockDiscovery);
  }
}

/**
 * Create a valid test world
 */
function createTestWorld(): World {
  return {
    world_name: "Test World",
    world_description: "A test world for unit tests",
    starting_location: "tavern",
    entities: [
      {
        id: "tavern",
        name: "The Tavern",
        type: "place",
        description: "A cozy tavern",
        connections: { "forest": {} },
      },
      {
        id: "forest",
        name: "Dark Forest",
        type: "place",
        description: "A dark forest",
        connections: { "tavern": {} },
      },
      {
        id: "player",
        name: "Hero",
        type: "person",
        description: "The brave hero",
        location: "tavern",
        health: 100,
        energy: 100,
        inventory: [],
      },
      {
        id: "npc",
        name: "Bartender",
        type: "person",
        description: "A friendly bartender",
        location: "tavern",
        health: 100,
        energy: 100,
        inventory: [],
      },
      {
        id: "potion",
        name: "Health Potion",
        type: "item",
        description: "Restores health",
        location: "tavern",
        usable: true,
        consumable: true,
        effects: { health: 50, energy: 0 },
      },
    ],
  };
}

// ========================================
// Tests for initializeGame()
// ========================================

Deno.test("GameService.initializeGame - successfully creates a game", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const worldGenerator = new MockWorldGenerator(mockWorld);
  const narrator = new MockNarrator();
  const actionSelector = new MockActionSelector();
  const discoveryGenerator = new MockDiscoveryGenerator();

  const gameService = new GameService(
    sessionManager,
    worldGenerator,
    narrator,
    actionSelector,
    discoveryGenerator,
  );

  const result = await gameService.initializeGame("test world");

  assertEquals(result.sessionId, "mock-session-id");
  assertEquals(result.world, mockWorld);
  assertEquals(result.openingScene, "Welcome to the test world!");
  assertEquals(result.availableCharacters.length, 2); // player and npc
  assertEquals(result.availableCharacters[0].type, "person");
});

Deno.test("GameService.initializeGame - retries on invalid world", async () => {
  const sessionManager = new MockSessionManager();

  // First two attempts return invalid world, third returns valid
  let attempt = 0;
  const worldGenerator: IWorldGenerator = {
    generateWorld(_desc: string): Promise<World | null> {
      attempt++;
      if (attempt < 3) {
        // Return invalid world (missing entities)
        return Promise.resolve({
          world_name: "Bad World",
          world_description: "Invalid",
          starting_location: "nowhere",
          entities: [],
        });
      }
      return Promise.resolve(createTestWorld());
    },
    generateOpeningScene(_w: World, _m: Message[]): Promise<string> {
      return Promise.resolve("Welcome!");
    },
  };

  const gameService = new GameService(
    sessionManager,
    worldGenerator,
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  const result = await gameService.initializeGame("test");

  // Should succeed on third attempt
  assertEquals(result.world.world_name, "Test World");
  assertEquals(attempt, 3);
});

Deno.test("GameService.initializeGame - throws after max retries", async () => {
  const sessionManager = new MockSessionManager();
  const worldGenerator = new MockWorldGenerator(null); // Always returns null

  const gameService = new GameService(
    sessionManager,
    worldGenerator,
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  let error: Error | null = null;
  try {
    await gameService.initializeGame("test");
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  assertEquals(error?.message, "Unable to generate world");
});

// ========================================
// Tests for selectCharacter()
// ========================================

Deno.test("GameService.selectCharacter - successfully selects character", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);
  await sessionManager.updateOpeningScene(session.sessionId, "Opening scene");

  const mockActions: Action[] = [
    { type: "REST", description: "Rest", energyCost: 0 },
    { type: "WAIT", description: "Wait", energyCost: 0 },
  ];

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator(),
    new MockActionSelector(mockActions),
    new MockDiscoveryGenerator(),
  );

  const result = await gameService.selectCharacter(session.sessionId, "player");

  assertEquals(result.success, true);
  assertEquals(result.character.id, "player");
  assertEquals(result.gameState.health, 100);
  assertEquals(result.gameState.energy, 100);
  assertEquals(result.availableActions.length, 2);
});

Deno.test("GameService.selectCharacter - throws on invalid character", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  let error: Error | null = null;
  try {
    await gameService.selectCharacter(session.sessionId, "invalid-character");
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  assertEquals(error?.message, "Invalid character selection");
});

Deno.test("GameService.selectCharacter - throws on no world generated", async () => {
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(null),
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  let error: Error | null = null;
  try {
    await gameService.selectCharacter(session.sessionId, "player");
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  assertEquals(error?.message, "Invalid session or world not generated");
});

// ========================================
// Tests for performAction()
// ========================================

Deno.test("GameService.performAction - executes a simple action", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 1,
    messageHistory: [
      { role: "system", content: "Test game" },
    ],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator("You rested peacefully."),
    new MockActionSelector([
      { type: "REST", description: "Rest", energyCost: 0 },
    ]),
    new MockDiscoveryGenerator(),
  );

  const action: Action = { type: "REST", description: "Rest", energyCost: 0 };
  const result = await gameService.performAction(session.sessionId, action);

  assertEquals(result.success, true);
  assertEquals(result.narration, "You rested peacefully.");
  assertEquals(result.gameState.energy, 100);
  assertEquals(result.gameOver, false);
  assertEquals(result.availableActions.length, 1);
});

Deno.test("GameService.performAction - handles EXPLORE with discovery", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 1,
    messageHistory: [{ role: "system", content: "Test" }],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const mockDiscovery: Entity = {
    id: "treasure",
    name: "Treasure Chest",
    type: "item",
    description: "A mysterious treasure",
    location: "tavern",
    usable: false,
    consumable: false,
  };

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator("You discover a treasure chest!"),
    new MockActionSelector([]),
    new MockDiscoveryGenerator(mockDiscovery),
  );

  const action: Action = {
    type: "EXPLORE",
    description: "Explore",
    energyCost: 4,
  };
  const result = await gameService.performAction(session.sessionId, action);

  assertEquals(result.success, true);
  assertEquals(result.discovery?.id, "treasure");
  assertEquals(result.discovery?.name, "Treasure Chest");
  assertEquals(result.gameState.energy, 96); // 100 - 4

  // Verify discovery was added to world
  const updatedSession = await sessionManager.getSession(session.sessionId);
  const worldEntities = updatedSession?.currentGameState?.world.entities;
  const foundTreasure = worldEntities?.find((e) => e.id === "treasure");
  assertEquals(foundTreasure !== undefined, true);
});

Deno.test("GameService.performAction - handles EXPLORE with no discovery", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 1,
    messageHistory: [{ role: "system", content: "Test" }],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator("You search but find nothing."),
    new MockActionSelector([]),
    new MockDiscoveryGenerator(null), // No discovery
  );

  const action: Action = {
    type: "EXPLORE",
    description: "Explore",
    energyCost: 4,
  };
  const result = await gameService.performAction(session.sessionId, action);

  assertEquals(result.success, true);
  assertEquals(result.discovery, undefined);
});

Deno.test("GameService.performAction - detects game over on zero health", async () => {
  const mockWorld = createTestWorld();
  const player = mockWorld.entities.find((e) => e.id === "player")!;
  player.health = 1; // Almost dead

  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 1,
    messageHistory: [{ role: "system", content: "Test" }],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator("Fatal damage!"),
    new MockActionSelector([]),
    new MockDiscoveryGenerator(),
  );

  // Use a damaging potion to kill player
  const damagePotion: Entity = {
    id: "poison",
    name: "Poison",
    type: "item",
    description: "Deadly poison",
    location: "player",
    usable: true,
    consumable: true,
    effects: { health: -10, energy: 0 },
  };
  mockWorld.entities.push(damagePotion);
  player.inventory!.push("poison");

  const action: Action = {
    type: "USE_ITEM",
    target: "poison",
    description: "Use poison",
    energyCost: 0,
  };
  const result = await gameService.performAction(session.sessionId, action);

  assertEquals(result.gameOver, true);
  assertEquals(
    result.gameOverReason,
    "You have died. Your adventure ends here.",
  );
  assertEquals(result.availableActions.length, 0); // No actions when dead
  assertEquals(result.gameState.health, 0);
});

Deno.test("GameService.performAction - updates message history", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 1,
    messageHistory: [{ role: "system", content: "Start" }],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator("Action performed."),
    new MockActionSelector([]),
    new MockDiscoveryGenerator(),
  );

  const action: Action = { type: "WAIT", description: "Wait", energyCost: 0 };
  await gameService.performAction(session.sessionId, action);

  const updatedSession = await sessionManager.getSession(session.sessionId);
  const history = updatedSession?.currentGameState?.messageHistory;

  assertEquals(history?.length, 3); // system + user + assistant
  assertEquals(history?.[1].role, "user");
  assertEquals(history?.[1].content, "Player action: Wait");
  assertEquals(history?.[2].role, "assistant");
  assertEquals(history?.[2].content, "Action performed.");
});

// ========================================
// Tests for getStatus()
// ========================================

Deno.test("GameService.getStatus - returns not_initialized status", async () => {
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test world");

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(null),
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  const result = await gameService.getStatus(session.sessionId);

  assertEquals(result.status, "not_initialized");
  assertEquals(result.worldDescription, "test world");
});

Deno.test("GameService.getStatus - returns character_selection status", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);
  await sessionManager.updateOpeningScene(session.sessionId, "Opening!");

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  const result = await gameService.getStatus(session.sessionId);

  assertEquals(result.status, "character_selection");
  assertEquals(result.world, mockWorld);
  assertEquals(result.openingScene, "Opening!");
  assertEquals(result.availableCharacters?.length, 2);
});

Deno.test("GameService.getStatus - returns active status with game state", async () => {
  const mockWorld = createTestWorld();
  const sessionManager = new MockSessionManager();
  const session = await sessionManager.createSession("test");
  await sessionManager.updateWorld(session.sessionId, mockWorld);

  const gameState: GameState = {
    world: mockWorld,
    playerId: "player",
    currentTurn: 5,
    messageHistory: [{ role: "system", content: "Test" }],
  };
  await sessionManager.updateGameState(session.sessionId, gameState);

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(mockWorld),
    new MockNarrator(),
    new MockActionSelector([
      { type: "REST", description: "Rest", energyCost: 0 },
    ]),
    new MockDiscoveryGenerator(),
  );

  const result = await gameService.getStatus(session.sessionId);

  assertEquals(result.status, "active");
  assertEquals(result.currentTurn, 5);
  assertEquals(result.playerState?.health, 100);
  assertEquals(result.playerState?.currentLocation, "tavern");
  assertEquals(result.worldName, "Test World");
  assertEquals(result.currentLocation?.name, "The Tavern");
  assertEquals(result.availableActions?.length, 1);
});

Deno.test("GameService.getStatus - throws on invalid session", async () => {
  const sessionManager = new MockSessionManager();

  const gameService = new GameService(
    sessionManager,
    new MockWorldGenerator(null),
    new MockNarrator(),
    new MockActionSelector(),
    new MockDiscoveryGenerator(),
  );

  let error: Error | null = null;
  try {
    await gameService.getStatus("invalid-session-id");
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  assertEquals(error?.message, "Session not found");
});
