import { Ollama } from "ollama";
import type { Action, Entity, World } from "./types.ts";

// Configure Ollama client with cloud API
const ollamaClient = new Ollama({
  host: Deno.env.get("OLLAMA_API_URL") || "https://ollama.com",
  headers: {
    "Authorization": `Bearer ${Deno.env.get("OLLAMA_API_KEY")}`,
  },
});

// Model configuration - you can adjust these
const DEFAULT_MODEL = "gpt-oss:120b-cloud";

// Message type for chat history
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Generate a complete game world from a description
export async function generateWorld(
  worldDescription: string,
): Promise<World | null> {
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

    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
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
      !world.world_name || !world.world_description || !world.starting_location
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

// Generate the opening scene for a game
export async function generateOpeningScene(
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
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
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

// Select the most interesting actions from available ones
export async function selectInterestingActions(
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
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
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

// Narrate what happens when an action is performed
export async function narrateAction(
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
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
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

// Generate a discovery when exploring
export async function generateDiscovery(
  world: World,
  playerId: string,
  messageHistory: Message[],
): Promise<Entity | undefined> {
  const player = world.entities.find((e) => e.id === playerId)!;
  const currentLocation = world.entities.find((e) => e.id === player.location)!;

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
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
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
      return undefined;
    }

    // If it's a new place, we need to also update the current location's connections
    if (discovery.type === "place" && currentLocation.type === "place") {
      if (!currentLocation.connections) {
        currentLocation.connections = {};
      }
      currentLocation.connections[discovery.id] = {};
    }

    return discovery;
  } catch (error) {
    console.error("Failed to generate discovery:", error);
    return undefined;
  }
}
