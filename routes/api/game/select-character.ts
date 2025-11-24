import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import { ActionEngine } from "@/lib/game/engine.ts";
import { type Message, selectInterestingActions } from "@/lib/game/llm.ts";
import type { ErrorResponse, GameState } from "@/lib/game/types.ts";

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
      const { characterId } = body;

      if (!characterId || typeof characterId !== "string") {
        return new Response(
          JSON.stringify({
            error: "Bad Request",
            message: "characterId is required",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Get session
      const sessionManager = await getSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session || !session.generatedWorld) {
        return new Response(
          JSON.stringify({
            error: "Session Error",
            message: "Invalid session or world not generated",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
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
        return new Response(
          JSON.stringify({
            error: "Bad Request",
            message: "Invalid character selection",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
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
      await sessionManager.updateGameState(sessionId, gameState);

      // Generate initial actions
      const engine = new ActionEngine(world);
      const allActions = engine.generateValidActions(characterId);
      const availableActions = await selectInterestingActions(
        allActions,
        world,
        characterId,
        messageHistory,
      );

      const playerState = engine.getPlayerState(characterId);

      return new Response(
        JSON.stringify({
          success: true,
          character,
          gameState: playerState,
          availableActions,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("Error in select-character:", error);
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
