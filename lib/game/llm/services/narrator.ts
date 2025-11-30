import type { Action, World } from "../../types.ts";
import type { ILLMClient } from "../client/interface.ts";
import { CloudLLMClient } from "../client/cloud-client.ts";
import type { INarrator, Message } from "./interface.ts";

const FAST_MODEL = "gpt-oss:20b-cloud";

/**
 * LLM-powered action narration service
 */
export class LLMNarrator implements INarrator {
  constructor(
    private client: ILLMClient = new CloudLLMClient(),
    private model: string = FAST_MODEL,
  ) {}

  async narrateAction(
    action: Action,
    changes: string[],
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<string> {
    const player = world.entities.find((e) => e.id === playerId)!;
    const location = world.entities.find((e) => e.id === player.location)!;
    const target = action.target
      ? world.entities.find((e) => e.id === action.target)
      : null;

    const context = `Action Taken: ${action.description}
Location: ${location.name}
Player Status: Health ${player.health}/100, Energy ${player.energy}/100
Game Changes: ${changes.join("; ")}
${target ? `Target: ${target.name} - ${target.description}` : ""}`;

    const prompt =
      `Narrate what happened when the player performed this action. Write 1-3 sentences of vivid, engaging narrative that:
- Describes the action and its immediate effects
- Includes sensory details and atmosphere
- Shows character reactions if relevant
- Hints at future possibilities

${context}`;

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          ...messageHistory.slice(-5), // Include recent history
          { role: "user", content: prompt },
        ],
      });

      return response.message.content;
    } catch (error) {
      console.error("Failed to narrate action:", error);
      return `You ${action.description.toLowerCase()}. ${changes.join(" ")}`;
    }
  }
}
