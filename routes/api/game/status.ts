import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import { ActionEngine } from "@/lib/game/engine.ts";
import { selectInterestingActions } from "@/lib/game/llm.ts";
import type { ErrorResponse } from "@/lib/game/types.ts";

export const handler = define.handlers({
  async GET(ctx) {
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

      // Get session
      const sessionManager = await getSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        return new Response(
          JSON.stringify({
            error: "Session Error",
            message: "Session not found",
          } as ErrorResponse),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Check if game is initialized
      if (!session.generatedWorld) {
        return new Response(
          JSON.stringify({
            status: "not_initialized",
            sessionId,
            worldDescription: session.worldDescription,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Check if character is selected
      if (!session.currentGameState) {
        const availableCharacters = session.generatedWorld.entities.filter(
          (e) =>
            e.type === "person" &&
            e.location === session.generatedWorld!.starting_location,
        );

        return new Response(
          JSON.stringify({
            status: "character_selection",
            sessionId,
            world: session.generatedWorld,
            openingScene: session.openingScene,
            availableCharacters,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Game is active
      const gameState = session.currentGameState;
      const world = gameState.world;
      const playerId = gameState.playerId;

      const engine = new ActionEngine(world);
      const playerState = engine.getPlayerState(playerId);

      // Generate available actions
      const allActions = engine.generateValidActions(playerId);
      const availableActions = await selectInterestingActions(
        allActions,
        world,
        playerId,
        gameState.messageHistory,
      );

      return new Response(
        JSON.stringify({
          status: "active",
          sessionId,
          currentTurn: gameState.currentTurn,
          playerState,
          availableActions,
          worldName: world.world_name,
          currentLocation: engine.getEntity(playerState?.currentLocation || ""),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("Error in game/status:", error);
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
