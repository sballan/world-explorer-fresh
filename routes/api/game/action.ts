import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import { ActionEngine } from "@/lib/game/engine.ts";
import {
  narrateAction,
  selectInterestingActions,
  generateDiscovery,
  type Message,
} from "@/lib/game/llm.ts";
import type { Action, GameActionResponse, ErrorResponse } from "@/lib/game/types.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      // Get session ID from cookie
      const cookies = ctx.req.headers.get("cookie") || "";
      const sessionMatch = cookies.match(/game-session=([^;]+)/);
      const sessionId = sessionMatch?.[1];

      if (!sessionId) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized",
            message: "No game session found",
          } as ErrorResponse),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Parse request body
      const body = await ctx.req.json();
      const action = body.action as Action;

      if (!action || !action.type) {
        return new Response(
          JSON.stringify({
            error: "Bad Request",
            message: "Valid action is required",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Get session and game state
      const sessionManager = await getSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session || !session.currentGameState) {
        return new Response(
          JSON.stringify({
            error: "Session Error",
            message: "No active game found",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const gameState = session.currentGameState;
      const world = gameState.world;
      const playerId = gameState.playerId;

      // Execute the action
      const engine = new ActionEngine(world);
      const result = engine.executeAction(playerId, action);

      // Handle EXPLORE action - generate discovery
      let discovery = null;
      if (action.type === "EXPLORE") {
        discovery = await generateDiscovery(
          world,
          playerId,
          gameState.messageHistory,
        );

        if (discovery) {
          // Add the discovery to the world
          world.entities.push(discovery);

          // If it's a new place, update connections
          if (discovery.type === "place") {
            const player = world.entities.find((e) => e.id === playerId)!;
            const currentLocation = world.entities.find(
              (e) => e.id === player.location,
            )!;
            if (currentLocation.connections) {
              currentLocation.connections[discovery.id] = {};
            }
          }

          // Add discovery text to changes
          if (discovery.type === "place") {
            result.changes.push(
              `You discovered a new location: ${discovery.name}!`,
            );
          } else if (discovery.type === "item") {
            result.changes.push(`You found ${discovery.name}!`);
          } else if (discovery.type === "person") {
            result.changes.push(`You encountered ${discovery.name}!`);
          }
        } else {
          result.changes.push(
            "You search thoroughly but find nothing new this time.",
          );
        }
      }

      // Generate narration
      const narration = await narrateAction(
        action,
        result.changes,
        world,
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

      // Update the game state in session
      await sessionManager.updateGameState(sessionId, gameState);

      // Get player state
      const playerState = engine.getPlayerState(playerId);

      // Check win/lose conditions
      let gameOver = false;
      let gameOverReason = "";

      if (playerState && playerState.health === 0) {
        gameOver = true;
        gameOverReason = "You have died. Your adventure ends here.";
      }

      // Generate new actions if game is not over
      let availableActions: Action[] = [];
      if (!gameOver) {
        const allActions = engine.generateValidActions(playerId);
        availableActions = await selectInterestingActions(
          allActions,
          world,
          playerId,
          gameState.messageHistory,
        );
      }

      const response: GameActionResponse = {
        success: result.success,
        narration,
        gameState: playerState!,
        availableActions,
        discovery,
        gameOver,
        gameOverReason,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in game/action:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        } as ErrorResponse),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});