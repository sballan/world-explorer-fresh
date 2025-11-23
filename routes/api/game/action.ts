import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";

import { GameService } from "@/lib/game/game-service.ts";
import type {
  Action,
  ErrorResponse,
  GameActionResponse,
} from "@/lib/game/types.ts";

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

      // Use GameService to perform the action
      const sessionManager = await getSessionManager();
      const gameService = new GameService(sessionManager);
      const result = await gameService.performAction(sessionId, action);

      const response: GameActionResponse = {
        success: result.success,
        narration: result.narration,
        gameState: result.gameState,
        availableActions: result.availableActions,
        discovery: result.discovery,
        gameOver: result.gameOver,
        gameOverReason: result.gameOverReason,
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
