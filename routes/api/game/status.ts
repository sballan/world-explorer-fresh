import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import { GameService } from "@/lib/game/game-service.ts";
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

      // Use GameService to get status
      const sessionManager = await getSessionManager();
      const gameService = new GameService(sessionManager);
      const result = await gameService.getStatus(sessionId);

      return new Response(
        JSON.stringify(result),
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
