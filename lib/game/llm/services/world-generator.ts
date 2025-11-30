import type { World } from "../../types.ts";
import type { ILLMClient } from "../client/interface.ts";
import { CloudLLMClient } from "../client/cloud-client.ts";
import type { IWorldGenerator, Message } from "./interface.ts";

const DEFAULT_MODEL = "gpt-oss:120b-cloud";

/**
 * LLM-powered world generation service
 */
export class LLMWorldGenerator implements IWorldGenerator {
  constructor(
    private client: ILLMClient = new CloudLLMClient(),
    private model: string = DEFAULT_MODEL,
  ) {}

  async generateWorld(worldDescription: string): Promise<World | null> {
    const systemPrompt =
      `You must generate a game world that conforms EXACTLY to this JSON structure:

{
  "world_name": "Name of the world",
  "world_description": "Brief description of the world",
  "starting_location": "id_of_starting_place",
  "entities": [
    // Array of entities goes here
  ]
}

ENTITY SCHEMA for the entities array:
Each entity must be one of these types:

PERSON entity:
{
  "id": "unique_id",
  "name": "Display Name",
  "type": "person",
  "description": "Character description",
  "location": "place_id",
  "health": 100,
  "energy": 100,
  "inventory": []
}

PLACE entity:
{
  "id": "unique_id",
  "name": "Display Name",
  "type": "place",
  "description": "Place description",
  "connections": {
    "other_place_id": {},
    "another_place_id": {"requires_item": "key_id"}
  }
}

ITEM entity:
{
  "id": "unique_id",
  "name": "Display Name",
  "type": "item",
  "description": "Item description",
  "location": "place_or_person_id",
  "usable": true,
  "consumable": false,
  "effects": {"health": 10, "energy": -5}
}

WORLD REQUIREMENTS:
- Create 3-5 places forming a connected graph
- Create 2-4 people (potential player characters)
- Create 3-6 items distributed across locations
- All places must be reachable from each other
- At least one person must be at starting_location
- The starting_location must be the id of one of the place entities

USER REQUEST: ${worldDescription}

Return ONLY the JSON object with world_name, world_description, starting_location, and entities array.`;

    try {
      console.log("Generating world based on description...");

      const response = await this.client.chat({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Create a game world based on: ${worldDescription}`,
          },
        ],
        format: "json",
      });

      const world = JSON.parse(response.message.content) as World;

      // Basic validation
      if (!world.entities || !Array.isArray(world.entities)) {
        console.error("Generated world missing 'entities' array");
        return null;
      }
      if (
        !world.world_name || !world.world_description ||
        !world.starting_location
      ) {
        console.error("Generated world missing required fields");
        return null;
      }

      return world;
    } catch (error) {
      console.error("Failed to generate world:", error);
      return null;
    }
  }

  async generateOpeningScene(
    world: World,
    messageHistory: Message[],
  ): Promise<string> {
    const startingPlace = world.entities.find((e) =>
      e.id === world.starting_location
    );
    const peopleAtStart = world.entities.filter(
      (e) => e.type === "person" && e.location === world.starting_location,
    );
    const itemsAtStart = world.entities.filter(
      (e) => e.type === "item" && e.location === world.starting_location,
    );

    const context = `World: ${world.world_name}
Description: ${world.world_description}
Current Location: ${startingPlace?.name} - ${startingPlace?.description}
Characters Present: ${
      peopleAtStart.map((p) => `${p.name} - ${p.description}`).join("; ")
    }
Items Present: ${
      itemsAtStart.map((i) => `${i.name} - ${i.description}`).join("; ")
    }`;

    const prompt =
      `Generate an opening scene for this game world. The scene should:
- Describe the setting vividly
- Introduce the characters present
- Set up an initial situation or conflict
- End at a moment of decision
- Be 2-4 paragraphs long

Context:
${context}`;

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          ...messageHistory,
          { role: "user", content: prompt },
        ],
      });

      return response.message.content;
    } catch (error) {
      console.error("Failed to generate opening scene:", error);
      return "You find yourself in an unfamiliar place...";
    }
  }
}
