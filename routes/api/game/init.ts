import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import { GameService } from "@/lib/game/game-service.ts";
import type { ErrorResponse, GameInitResponse } from "@/lib/game/types.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      // Parse request body
      const body = await ctx.req.json();
      const { worldDescription } = body;

      if (!worldDescription || typeof worldDescription !== "string") {
        return new Response(
          JSON.stringify({
            error: "Bad Request",
            message: "worldDescription is required",
          } as ErrorResponse),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Use GameService to initialize the game
      const sessionManager = await getSessionManager();
      const gameService = new GameService(sessionManager);
      const result = await gameService.initializeGame(worldDescription);

      const response: GameInitResponse = {
        sessionId: result.sessionId,
        world: result.world,
        openingScene: result.openingScene,
        availableCharacters: result.availableCharacters,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `game-session=${result.sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        },
      });
    } catch (error) {
      console.error("Error in game/init:", error);
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
