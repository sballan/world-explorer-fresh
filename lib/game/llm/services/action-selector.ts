import type { Action, World } from "../../types.ts";
import type { ILLMClient } from "../client/interface.ts";
import { CloudLLMClient } from "../client/cloud-client.ts";
import type { IActionSelector, Message } from "./interface.ts";

const FAST_MODEL = "gpt-oss:20b-cloud";

/**
 * LLM-powered action selection service
 */
export class LLMActionSelector implements IActionSelector {
  constructor(
    private client: ILLMClient = new CloudLLMClient(),
    private model: string = FAST_MODEL,
  ) {}

  async selectInterestingActions(
    actions: Action[],
    world: World,
    playerId: string,
    messageHistory: Message[],
    maxActions: number = 9,
  ): Promise<Action[]> {
    // Always include MOVE actions (travel options) - they should be at the top
    const moveActions = actions.filter((a) => a.type === "MOVE");

    // Always include EXPLORE if available
    const exploreAction = actions.find((a) => a.type === "EXPLORE");

    // Get all other actions
    const otherActions = actions.filter((a) =>
      a.type !== "MOVE" && a.type !== "EXPLORE"
    );

    // Start with MOVE actions at the top
    const selectedActions: Action[] = [...moveActions];

    // Add EXPLORE if available
    if (exploreAction) {
      selectedActions.push(exploreAction);
    }

    // If we already have enough actions with just MOVE + EXPLORE, return them
    if (selectedActions.length >= maxActions) {
      return selectedActions.slice(0, maxActions);
    }

    const slotsRemaining = maxActions - selectedActions.length;

    if (otherActions.length <= slotsRemaining) {
      // If we have few enough other actions, just include them all
      return [...selectedActions, ...otherActions];
    }

    // Use LLM to select the most interesting remaining actions
    const player = world.entities.find((e) => e.id === playerId)!;
    const location = world.entities.find((e) => e.id === player.location)!;

    const context = `Current Location: ${location.name}
Player Health: ${player.health}/100
Player Energy: ${player.energy}/100
Available Actions: ${otherActions.map((a) => a.description).join(", ")}`;

    const prompt =
      `From these available actions, select the ${slotsRemaining} most interesting/appropriate options for the player to choose from. Consider narrative flow, dramatic tension, and player agency.

${context}

Return a JSON array containing exactly ${slotsRemaining} action descriptions from the available list. Response in valid JSON format only.`;

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          ...messageHistory.slice(-5), // Include recent history
          { role: "user", content: prompt },
        ],
        format: "json",
      });

      const selectedDescriptions = JSON.parse(
        response.message.content,
      ) as string[];
      const additionalActions = otherActions.filter((a) =>
        selectedDescriptions.includes(a.description)
      ).slice(0, slotsRemaining);

      return [...selectedActions, ...additionalActions];
    } catch (error) {
      console.error("Failed to select actions:", error);
      // Return selected plus first few other actions as fallback
      return [...selectedActions, ...otherActions.slice(0, slotsRemaining)];
    }
  }
}
