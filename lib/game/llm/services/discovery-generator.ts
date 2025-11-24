import type { Entity, World } from "../../types.ts";
import type { ILLMClient } from "../client/interface.ts";
import { CloudLLMClient } from "../client/cloud-client.ts";
import type { IDiscoveryGenerator, Message } from "./interface.ts";

const FAST_MODEL = "gpt-oss:20b-cloud";

/**
 * LLM-powered discovery generation service
 */
export class LLMDiscoveryGenerator implements IDiscoveryGenerator {
  constructor(
    private client: ILLMClient = new CloudLLMClient(),
    private model: string = FAST_MODEL,
  ) {}

  async generateDiscovery(
    world: World,
    playerId: string,
    messageHistory: Message[],
  ): Promise<Entity | null> {
    const player = world.entities.find((e) => e.id === playerId)!;
    const currentLocation = world.entities.find((e) =>
      e.id === player.location
    )!;

    // Get existing entities at this location for context
    const entitiesHere = world.entities.filter(
      (e) =>
        (e.type === "person" || e.type === "item") &&
        e.location === player.location,
    );

    // Get connected places for context
    const connectedPlaces = currentLocation.connections
      ? Object.keys(currentLocation.connections).map((id) =>
        world.entities.find((e) => e.id === id)
      ).filter(Boolean)
      : [];

    const context =
      `Current Location: ${currentLocation.name} - ${currentLocation.description}
Entities at this location: ${
        entitiesHere.map((e) => `${e.name} (${e.type})`).join(", ") || "None"
      }
Connected places: ${connectedPlaces.map((p) => p?.name).join(", ") || "None"}
World theme: ${world.world_description}

Generate ONE new discovery that makes sense for someone exploring this location.`;

    const prompt =
      `The player is exploring and should discover something new. Generate a single entity that fits naturally in this location and world.

${context}

Choose ONE of these discovery types:
1. A new PLACE connected to the current location (must add connection back to current location)
2. A new ITEM found at the current location
3. A new PERSON encountered at the current location

Return JSON for a single entity following the exact schema:

For a PLACE:
{
  "id": "unique_id_with_underscores",
  "name": "Place Name",
  "type": "place",
  "description": "Vivid description of the discovered location",
  "connections": {
    "${player.location}": {}
  }
}

For an ITEM:
{
  "id": "unique_id",
  "name": "Item Name",
  "type": "item",
  "description": "Description of the discovered item",
  "location": "${player.location}",
  "usable": true/false,
  "consumable": true/false,
  "effects": {"health": number, "energy": number}
}

For a PERSON:
{
  "id": "unique_id",
  "name": "Person Name",
  "type": "person",
  "description": "Description of the encountered character",
  "location": "${player.location}",
  "health": 80,
  "energy": 80,
  "inventory": []
}

Return ONLY the JSON object for the single discovered entity.`;

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          ...messageHistory.slice(-5), // Include recent history for context
          { role: "user", content: prompt },
        ],
        format: "json",
      });

      const discovery = JSON.parse(response.message.content) as Entity;

      // Validate the discovered entity has required fields
      if (
        !discovery.id || !discovery.name || !discovery.type ||
        !discovery.description
      ) {
        console.error("Generated discovery missing required fields");
        return null;
      }

      return discovery;
    } catch (error) {
      console.error("Failed to generate discovery:", error);
      return null;
    }
  }
}
