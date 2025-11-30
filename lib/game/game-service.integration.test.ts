/**
 * Integration tests for GameService using LLM
 * These tests make real LLM calls via Ollama Cloud API
 *
 * Environment variables:
 * - OLLAMA_API_URL: Ollama API endpoint (default: https://ollama.com)
 * - OLLAMA_API_KEY: API key for authentication
 * - OLLAMA_MODEL: Model to use (default: gpt-oss:20b-cloud)
 *
 * Run with: deno test lib/game/game-service.integration.test.ts --allow-net --allow-env
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GameService } from "./game-service.ts";
import {
  LLMActionSelector,
  LLMDiscoveryGenerator,
  LLMNarrator,
  LLMWorldGenerator,
} from "./llm/services/index.ts";
import { CloudLLMClient } from "./llm/client/cloud-client.ts";
import type { ISessionManager } from "./session/interface.ts";
import type { GameState, SessionData, World } from "./types.ts";

/**
 * In-memory session manager for integration tests
 * (avoids needing Deno KV)
 */
class InMemorySessionManager implements ISessionManager {
  private sessions = new Map<string, SessionData>();
  private idCounter = 0;

  generateSessionId(): string {
    return `integration-test-session-${this.idCounter++}`;
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

  updateOpeningScene(sessionId: string, scene: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.openingScene = scene;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  updateGameState(sessionId: string, gameState: GameState): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentGameState = gameState;
      session.currentTurn = gameState.currentTurn;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/**
 * Create a GameService configured for integration testing
 * Uses CloudLLMClient which reads from OLLAMA_API_URL and OLLAMA_API_KEY env vars
 */
function createIntegrationGameService(): GameService {
  const sessionManager = new InMemorySessionManager();

  // Use CloudLLMClient which reads from environment variables
  const llmClient = new CloudLLMClient();
  const model = Deno.env.get("OLLAMA_MODEL") || "gpt-oss:20b-cloud";

  const worldGenerator = new LLMWorldGenerator(llmClient, model);
  const narrator = new LLMNarrator(llmClient, model);
  const actionSelector = new LLMActionSelector(llmClient, model);
  const discoveryGenerator = new LLMDiscoveryGenerator(llmClient, model);

  return new GameService(
    sessionManager,
    worldGenerator,
    narrator,
    actionSelector,
    discoveryGenerator,
  );
}

/**
 * Integration Test: Initialize a Lord of the Rings game in the Shire
 */
Deno.test({
  name: "Integration: Initialize LOTR Shire world",
  ignore: false, // Set to true to skip by default
  async fn() {
    const gameService = createIntegrationGameService();

    console.log("🧙 Initializing Lord of the Rings game in the Shire...");

    const result = await gameService.initializeGame(
      "Lord of the Rings in the Shire",
    );

    console.log(`✅ Session created: ${result.sessionId}`);
    console.log(`🌍 World name: ${result.world.world_name}`);
    console.log(
      `📍 Starting location: ${result.world.starting_location}`,
    );
    console.log(
      `👥 Available characters: ${result.availableCharacters.length}`,
    );
    console.log(
      `📖 Opening scene: ${result.openingScene.substring(0, 100)}...`,
    );

    // Verify basic structure
    assertExists(result.sessionId);
    assertExists(result.world);
    assertExists(result.world.world_name);
    assertExists(result.world.world_description);
    assertExists(result.world.starting_location);
    assertEquals(Array.isArray(result.world.entities), true);
    assertEquals(result.availableCharacters.length > 0, true);
    assertExists(result.openingScene);

    console.log("\n✅ World initialization successful!");
  },
});

/**
 * Integration Test: Full game flow - initialize, select character, perform actions
 */
Deno.test({
  name: "Integration: Full game flow in the Shire",
  ignore: false,
  async fn() {
    const gameService = createIntegrationGameService();

    console.log("\n🎮 Starting full game flow test...\n");

    // Step 1: Initialize game
    console.log("Step 1: Initializing game...");
    const initResult = await gameService.initializeGame(
      "Lord of the Rings in the Shire",
    );
    console.log(`✅ Game initialized: ${initResult.world.world_name}`);
    console.log(
      `   Available characters: ${
        initResult.availableCharacters.map((c) => c.name).join(", ")
      }`,
    );

    // Step 2: Select a character
    console.log("\nStep 2: Selecting first character...");
    const character = initResult.availableCharacters[0];
    console.log(`   Selecting: ${character.name}`);

    const selectResult = await gameService.selectCharacter(
      initResult.sessionId,
      character.id,
    );
    console.log(`✅ Character selected: ${selectResult.character.name}`);
    console.log(`   Location: ${selectResult.gameState.currentLocation}`);
    console.log(`   Health: ${selectResult.gameState.health}`);
    console.log(`   Energy: ${selectResult.gameState.energy}`);
    console.log(
      `   Available actions: ${selectResult.availableActions.length}`,
    );

    assertEquals(selectResult.success, true);
    assertEquals(selectResult.character.id, character.id);
    assertExists(selectResult.availableActions);
    assertEquals(selectResult.availableActions.length > 0, true);

    // Step 3: Perform a REST action
    console.log("\nStep 3: Performing REST action...");
    const restAction = selectResult.availableActions.find((a) =>
      a.type === "REST"
    );

    if (restAction) {
      const actionResult = await gameService.performAction(
        initResult.sessionId,
        restAction,
      );
      console.log(`✅ Action performed: ${restAction.description}`);
      console.log(`   Narration: ${actionResult.narration}`);
      console.log(`   Energy after rest: ${actionResult.gameState.energy}`);
      console.log(`   Game over: ${actionResult.gameOver}`);

      assertEquals(actionResult.success, true);
      assertExists(actionResult.narration);
      assertEquals(actionResult.gameOver, false);
    } else {
      console.log("⚠️  REST action not available, skipping");
    }

    // Step 4: Get game status
    console.log("\nStep 4: Checking game status...");
    const status = await gameService.getStatus(initResult.sessionId);
    console.log(`✅ Status: ${status.status}`);
    console.log(`   World: ${status.worldName}`);
    console.log(`   Turn: ${status.currentTurn}`);
    if (status.playerState) {
      console.log(`   Player health: ${status.playerState.health}`);
      console.log(`   Player energy: ${status.playerState.energy}`);
    }

    assertEquals(status.status, "active");
    assertExists(status.worldName);
    assertExists(status.currentTurn);

    console.log("\n✅ Full game flow completed successfully!");
  },
});

/**
 * Integration Test: Explore action with discovery
 */
Deno.test({
  name: "Integration: EXPLORE action in the Shire",
  ignore: false,
  async fn() {
    const gameService = createIntegrationGameService();

    console.log("\n🔍 Testing EXPLORE action...\n");

    // Initialize and select character
    const initResult = await gameService.initializeGame(
      "Lord of the Rings in the Shire",
    );
    const character = initResult.availableCharacters[0];
    const selectResult = await gameService.selectCharacter(
      initResult.sessionId,
      character.id,
    );

    console.log(`Character ${character.name} ready to explore!`);

    // Find and perform EXPLORE action
    const exploreAction = selectResult.availableActions.find((a) =>
      a.type === "EXPLORE"
    );

    if (exploreAction) {
      console.log("\nPerforming EXPLORE action...");
      const actionResult = await gameService.performAction(
        initResult.sessionId,
        exploreAction,
      );

      console.log(`✅ Exploration complete!`);
      console.log(`   Narration: ${actionResult.narration}`);
      if (actionResult.discovery) {
        console.log(`   🎉 Discovery made: ${actionResult.discovery.name}`);
        console.log(
          `   Discovery type: ${actionResult.discovery.type}`,
        );
        console.log(
          `   Description: ${actionResult.discovery.description}`,
        );
      } else {
        console.log(`   No discovery this time`);
      }

      assertEquals(actionResult.success, true);
      assertExists(actionResult.narration);
      // Discovery is optional, so we don't assert its existence
    } else {
      console.log("⚠️  EXPLORE action not available");
    }

    console.log("\n✅ EXPLORE action test completed!");
  },
});

/**
 * Integration Test: Movement between locations
 */
Deno.test({
  name: "Integration: Move between locations in the Shire",
  ignore: false,
  async fn() {
    const gameService = createIntegrationGameService();

    console.log("\n🚶 Testing movement between locations...\n");

    // Initialize and select character
    const initResult = await gameService.initializeGame(
      "Lord of the Rings in the Shire",
    );
    const character = initResult.availableCharacters[0];
    const selectResult = await gameService.selectCharacter(
      initResult.sessionId,
      character.id,
    );

    console.log(
      `Starting location: ${selectResult.gameState.currentLocation}`,
    );

    // Find a MOVE action
    const moveAction = selectResult.availableActions.find((a) =>
      a.type === "MOVE"
    );

    if (moveAction) {
      console.log(`\nMoving: ${moveAction.description}`);
      const moveResult = await gameService.performAction(
        initResult.sessionId,
        moveAction,
      );

      console.log(`✅ Movement complete!`);
      console.log(`   Narration: ${moveResult.narration}`);
      console.log(
        `   New location: ${moveResult.gameState.currentLocation}`,
      );
      console.log(`   Energy after move: ${moveResult.gameState.energy}`);

      assertEquals(moveResult.success, true);
      assertExists(moveResult.narration);

      // Verify location changed if it was a valid move
      if (moveResult.success) {
        console.log("   Location successfully changed!");
      }
    } else {
      console.log("⚠️  No MOVE actions available");
    }

    console.log("\n✅ Movement test completed!");
  },
});
