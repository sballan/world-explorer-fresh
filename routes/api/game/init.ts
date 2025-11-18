import { define } from "@/utils.ts";
import { getSessionManager } from "@/lib/game/session.ts";
import {
  generateOpeningScene,
  generateWorld,
  type Message,
} from "@/lib/game/llm.ts";
import { validateWorld } from "@/lib/game/validation.ts";
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

      // Get session manager
      const sessionManager = await getSessionManager();

      // Create a new session
      const session = await sessionManager.createSession(worldDescription);

      // Generate world with retry logic
      let world = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!world && attempts < maxAttempts) {
        attempts++;
        console.log(`Generating world (attempt ${attempts}/${maxAttempts})...`);

        const generatedWorld = await generateWorld(worldDescription);

        if (generatedWorld) {
          const validation = validateWorld(generatedWorld);

          if (validation.valid) {
            world = generatedWorld;
          } else {
            console.log("World validation failed:", validation.errors);
            if (attempts === maxAttempts) {
              return new Response(
                JSON.stringify({
                  error: "World Generation Failed",
                  message:
                    "Failed to generate a valid world after multiple attempts",
                } as ErrorResponse),
                {
                  status: 500,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
          }
        }
      }

      if (!world) {
        return new Response(
          JSON.stringify({
            error: "World Generation Failed",
            message: "Unable to generate world",
          } as ErrorResponse),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Save world to session
      await sessionManager.updateWorld(session.sessionId, world);

      // Generate opening scene
      const messageHistory: Message[] = [
        {
          role: "system",
          content:
            `You are the narrator for an interactive text adventure game set in: ${world.world_description}`,
        },
      ];

      const openingScene = await generateOpeningScene(world, messageHistory);

      // Save opening scene
      await sessionManager.updateOpeningScene(session.sessionId, openingScene);

      // Get available characters (people at starting location)
      const availableCharacters = world.entities.filter(
        (e) => e.type === "person" && e.location === world.starting_location,
      );

      const response: GameInitResponse = {
        sessionId: session.sessionId,
        world,
        openingScene,
        availableCharacters,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `game-session=${session.sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
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
