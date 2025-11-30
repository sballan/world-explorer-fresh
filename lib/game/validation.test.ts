/**
 * Tests for validateWorld - world structure validation
 *
 * Run with: deno test lib/game/validation.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateWorld } from "./validation.ts";
import type { World } from "./types.ts";

/**
 * Create a valid test world as baseline
 */
function createValidWorld(): World {
  return {
    world_name: "Test World",
    world_description: "A test world for validation",
    starting_location: "tavern",
    entities: [
      {
        id: "tavern",
        name: "The Tavern",
        type: "place",
        description: "A cozy tavern",
        connections: { forest: {} },
      },
      {
        id: "forest",
        name: "Dark Forest",
        type: "place",
        description: "A dark forest",
        connections: { tavern: {} },
      },
      {
        id: "player",
        name: "Hero",
        type: "person",
        description: "The brave hero",
        location: "tavern",
        health: 100,
        energy: 100,
        inventory: [],
      },
      {
        id: "potion",
        name: "Health Potion",
        type: "item",
        description: "Restores health",
        location: "tavern",
        usable: true,
        consumable: true,
        effects: { health: 30 },
      },
    ],
  };
}

// ========================================
// Tests for basic structure validation
// ========================================

Deno.test("validateWorld - accepts valid world", () => {
  const world = createValidWorld();

  const result = validateWorld(world);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateWorld - rejects null/undefined world", () => {
  const result = validateWorld(null as unknown as World);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Invalid world object"), true);
});

Deno.test("validateWorld - rejects world without entities array", () => {
  const world = {
    world_name: "Test",
    world_description: "Test",
    starting_location: "tavern",
  } as World;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("World missing entities array"), true);
});

Deno.test("validateWorld - reports missing world_name", () => {
  const world = createValidWorld();
  world.world_name = "";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("World missing world_name"), true);
});

Deno.test("validateWorld - reports missing world_description", () => {
  const world = createValidWorld();
  world.world_description = "";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("World missing world_description"), true);
});

Deno.test("validateWorld - reports missing starting_location", () => {
  const world = createValidWorld();
  world.starting_location = "";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("World missing starting_location"), true);
});

// ========================================
// Tests for entity validation
// ========================================

Deno.test("validateWorld - reports duplicate entity ids", () => {
  const world = createValidWorld();
  world.entities.push({
    id: "tavern", // Duplicate!
    name: "Another Tavern",
    type: "place",
    description: "A duplicate",
    connections: {},
  });

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Duplicate entity id: tavern"), true);
});

Deno.test("validateWorld - reports invalid starting_location", () => {
  const world = createValidWorld();
  world.starting_location = "nonexistent";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) =>
      e.includes("Starting location 'nonexistent' does not exist")
    ),
    true,
  );
});

Deno.test("validateWorld - reports starting_location that is not a place", () => {
  const world = createValidWorld();
  world.starting_location = "player"; // player is a person, not a place

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("does not exist or is not a place")),
    true,
  );
});

// ========================================
// Tests for person validation
// ========================================

Deno.test("validateWorld - reports person with invalid location", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = "nonexistent";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid location"),
    true,
  );
});

Deno.test("validateWorld - reports person with undefined location", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = undefined;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid location"),
    true,
  );
});

Deno.test("validateWorld - reports person with invalid health (undefined)", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = undefined;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid health"),
    true,
  );
});

Deno.test("validateWorld - reports person with invalid health (negative)", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = -10;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid health"),
    true,
  );
});

Deno.test("validateWorld - reports person with invalid health (> 100)", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 150;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid health"),
    true,
  );
});

Deno.test("validateWorld - reports person with invalid energy", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = -5;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' has invalid energy"),
    true,
  );
});

Deno.test("validateWorld - reports person missing inventory", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = undefined;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Person 'player' missing inventory array"),
    true,
  );
});

Deno.test("validateWorld - accepts person with health 0", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 0;

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

Deno.test("validateWorld - accepts person with health 100", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 100;

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

// ========================================
// Tests for place validation
// ========================================

Deno.test("validateWorld - reports place missing connections", () => {
  const world = createValidWorld();
  const tavern = world.entities.find((e) => e.id === "tavern")!;
  tavern.connections = undefined;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Place 'tavern' missing connections"),
    true,
  );
});

Deno.test("validateWorld - reports place with connection to invalid place", () => {
  const world = createValidWorld();
  const tavern = world.entities.find((e) => e.id === "tavern")!;
  tavern.connections = { nonexistent: {} };

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes(
      "Place 'tavern' has connection to invalid place 'nonexistent'",
    ),
    true,
  );
});

Deno.test("validateWorld - reports place with requires_item referencing invalid item", () => {
  const world = createValidWorld();
  const tavern = world.entities.find((e) => e.id === "tavern")!;
  tavern.connections = { forest: { requires_item: "nonexistent_key" } };

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes(
      "Place 'tavern' requires invalid item 'nonexistent_key'",
    ),
    true,
  );
});

Deno.test("validateWorld - accepts place with valid requires_item", () => {
  const world = createValidWorld();
  const tavern = world.entities.find((e) => e.id === "tavern")!;
  tavern.connections = { forest: { requires_item: "potion" } };

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

Deno.test("validateWorld - accepts place with empty connections", () => {
  const world = createValidWorld();
  // Remove all connections - places are still valid with empty connections object
  const tavern = world.entities.find((e) => e.id === "tavern")!;
  const forest = world.entities.find((e) => e.id === "forest")!;
  tavern.connections = {};
  forest.connections = {};

  const result = validateWorld(world);

  // Will fail for unreachable places, but connections itself is valid
  assertEquals(
    result.errors.some((e) => e.includes("missing connections")),
    false,
  );
});

// ========================================
// Tests for item validation
// ========================================

Deno.test("validateWorld - reports item with no location", () => {
  const world = createValidWorld();
  const potion = world.entities.find((e) => e.id === "potion")!;
  potion.location = undefined;

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Item 'potion' has no location"),
    true,
  );
});

Deno.test("validateWorld - reports item with invalid location", () => {
  const world = createValidWorld();
  const potion = world.entities.find((e) => e.id === "potion")!;
  potion.location = "nonexistent";

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("Item 'potion' has invalid location 'nonexistent'"),
    true,
  );
});

Deno.test("validateWorld - accepts item at a place location", () => {
  const world = createValidWorld();
  const potion = world.entities.find((e) => e.id === "potion")!;
  potion.location = "forest";

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

Deno.test("validateWorld - accepts item at a person location (inventory)", () => {
  const world = createValidWorld();
  const potion = world.entities.find((e) => e.id === "potion")!;
  potion.location = "player"; // Item in player's inventory

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

// ========================================
// Tests for people at starting location
// ========================================

Deno.test("validateWorld - reports no people at starting location", () => {
  const world = createValidWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = "forest"; // Move player away from starting location

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes("No people at starting location"),
    true,
  );
});

Deno.test("validateWorld - accepts multiple people at starting location", () => {
  const world = createValidWorld();
  world.entities.push({
    id: "npc",
    name: "Bartender",
    type: "person",
    description: "A friendly bartender",
    location: "tavern",
    health: 100,
    energy: 100,
    inventory: [],
  });

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

// ========================================
// Tests for place reachability
// ========================================

Deno.test("validateWorld - reports unreachable place", () => {
  const world = createValidWorld();
  // Add an isolated place with no connections to it
  world.entities.push({
    id: "island",
    name: "Remote Island",
    type: "place",
    description: "An isolated island",
    connections: {}, // No connections back
  });

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.includes(
      "Place 'island' is not reachable from starting location",
    ),
    true,
  );
});

Deno.test("validateWorld - accepts all places when fully connected", () => {
  const world = createValidWorld();
  // Add a third place that's connected
  world.entities.push({
    id: "cave",
    name: "Dark Cave",
    type: "place",
    description: "A mysterious cave",
    connections: { forest: {} },
  });
  // Update forest to connect to cave
  const forest = world.entities.find((e) => e.id === "forest")!;
  forest.connections = { tavern: {}, cave: {} };

  const result = validateWorld(world);

  assertEquals(result.valid, true);
});

Deno.test("validateWorld - handles one-way connections for reachability", () => {
  const world = createValidWorld();
  // Make forest only reachable from tavern (one-way)
  const forest = world.entities.find((e) => e.id === "forest")!;
  forest.connections = {}; // No way back, but still reachable

  const result = validateWorld(world);

  // Forest is reachable (from tavern), so no unreachable error
  assertEquals(
    result.errors.some((e) => e.includes("not reachable")),
    false,
  );
});

// ========================================
// Tests for multiple errors
// ========================================

Deno.test("validateWorld - reports multiple errors at once", () => {
  const world: World = {
    world_name: "",
    world_description: "",
    starting_location: "nonexistent",
    entities: [
      {
        id: "tavern",
        name: "Tavern",
        type: "place",
        description: "A place",
        connections: { invalid_place: {} },
      },
      {
        id: "player",
        name: "Player",
        type: "person",
        description: "A person",
        location: "invalid_location",
        health: -50,
        energy: 200,
        inventory: undefined,
      },
    ],
  };

  const result = validateWorld(world);

  assertEquals(result.valid, false);
  // Should have multiple errors
  assertEquals(result.errors.length > 3, true);
  assertEquals(result.errors.includes("World missing world_name"), true);
  assertEquals(result.errors.includes("World missing world_description"), true);
});
