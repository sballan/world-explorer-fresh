/**
 * Tests for ActionEngine - game mechanics and action execution
 *
 * Run with: deno test lib/game/engine.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ActionEngine } from "./engine.ts";
import type { Action, World } from "./types.ts";

/**
 * Create a basic test world with common entities
 */
function createTestWorld(): World {
  return {
    world_name: "Test World",
    world_description: "A test world",
    starting_location: "tavern",
    entities: [
      {
        id: "tavern",
        name: "The Tavern",
        type: "place",
        description: "A cozy tavern",
        connections: { forest: {}, locked_room: { requires_item: "key" } },
      },
      {
        id: "forest",
        name: "Dark Forest",
        type: "place",
        description: "A dark forest",
        connections: { tavern: {}, mountain: { requires_health: 50 } },
      },
      {
        id: "locked_room",
        name: "Locked Room",
        type: "place",
        description: "A mysterious locked room",
        connections: { tavern: {} },
      },
      {
        id: "mountain",
        name: "Mountain Peak",
        type: "place",
        description: "A tall mountain",
        connections: { forest: {} },
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
        id: "npc",
        name: "Bartender",
        type: "person",
        description: "A friendly bartender",
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
        effects: { health: 30, energy: 0 },
      },
      {
        id: "key",
        name: "Rusty Key",
        type: "item",
        description: "An old rusty key",
        location: "tavern",
        usable: false,
        consumable: false,
      },
      {
        id: "sword",
        name: "Iron Sword",
        type: "item",
        description: "A sturdy sword",
        location: "forest",
        usable: true,
        consumable: false,
        effects: { health: -10, energy: -5 },
      },
    ],
  };
}

// ========================================
// Tests for generateValidActions()
// ========================================

Deno.test("ActionEngine.generateValidActions - returns empty for invalid player", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("nonexistent");

  assertEquals(actions.length, 0);
});

Deno.test("ActionEngine.generateValidActions - returns empty for non-person entity", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("tavern"); // tavern is a place

  assertEquals(actions.length, 0);
});

Deno.test("ActionEngine.generateValidActions - always includes REST and WAIT", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const restAction = actions.find((a) => a.type === "REST");
  const waitAction = actions.find((a) => a.type === "WAIT");

  assertEquals(restAction !== undefined, true);
  assertEquals(restAction?.energyCost, 0);
  assertEquals(waitAction !== undefined, true);
  assertEquals(waitAction?.energyCost, 0);
});

Deno.test("ActionEngine.generateValidActions - includes EXPLORE when energy >= 5", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const exploreAction = actions.find((a) => a.type === "EXPLORE");
  assertEquals(exploreAction !== undefined, true);
  assertEquals(exploreAction?.energyCost, 4);
});

Deno.test("ActionEngine.generateValidActions - excludes EXPLORE when energy < 5", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 4;
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const exploreAction = actions.find((a) => a.type === "EXPLORE");
  assertEquals(exploreAction, undefined);
});

Deno.test("ActionEngine.generateValidActions - includes MOVE for connected places", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const moveActions = actions.filter((a) => a.type === "MOVE");
  assertEquals(moveActions.length, 1); // Only forest (locked_room requires key)
  assertEquals(moveActions[0].target, "forest");
  assertEquals(moveActions[0].energyCost, 5);
});

Deno.test("ActionEngine.generateValidActions - excludes MOVE when energy <= 10", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 10;
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const moveActions = actions.filter((a) => a.type === "MOVE");
  assertEquals(moveActions.length, 0);
});

Deno.test("ActionEngine.generateValidActions - excludes MOVE when requires_item not in inventory", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  // locked_room requires "key" which player doesn't have
  const moveToLocked = actions.find((a) =>
    a.type === "MOVE" && a.target === "locked_room"
  );
  assertEquals(moveToLocked, undefined);
});

Deno.test("ActionEngine.generateValidActions - includes MOVE when requires_item is in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["key"];
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const moveToLocked = actions.find((a) =>
    a.type === "MOVE" && a.target === "locked_room"
  );
  assertEquals(moveToLocked !== undefined, true);
});

Deno.test("ActionEngine.generateValidActions - excludes MOVE when requires_health not met", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = "forest";
  player.health = 30; // Mountain requires 50
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const moveToMountain = actions.find((a) =>
    a.type === "MOVE" && a.target === "mountain"
  );
  assertEquals(moveToMountain, undefined);
});

Deno.test("ActionEngine.generateValidActions - includes TALK for people at same location", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const talkActions = actions.filter((a) => a.type === "TALK");
  assertEquals(talkActions.length, 1);
  assertEquals(talkActions[0].target, "npc");
  assertEquals(talkActions[0].energyCost, 3);
});

Deno.test("ActionEngine.generateValidActions - excludes TALK when energy < 5", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 4;
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const talkActions = actions.filter((a) => a.type === "TALK");
  assertEquals(talkActions.length, 0);
});

Deno.test("ActionEngine.generateValidActions - includes TAKE_ITEM for items at location", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const takeActions = actions.filter((a) => a.type === "TAKE_ITEM");
  assertEquals(takeActions.length, 2); // potion and key
  assertEquals(takeActions[0].energyCost, 0);
});

Deno.test("ActionEngine.generateValidActions - includes DROP_ITEM for items in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["potion"];
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const dropActions = actions.filter((a) => a.type === "DROP_ITEM");
  assertEquals(dropActions.length, 1);
  assertEquals(dropActions[0].target, "potion");
});

Deno.test("ActionEngine.generateValidActions - includes USE_ITEM for usable items in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["potion", "key"]; // key is not usable
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const useActions = actions.filter((a) => a.type === "USE_ITEM");
  assertEquals(useActions.length, 1);
  assertEquals(useActions[0].target, "potion");
});

Deno.test("ActionEngine.generateValidActions - includes EXAMINE for entities when energy >= 2", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const examineActions = actions.filter((a) => a.type === "EXAMINE");
  // Should include: npc, potion, key, tavern (current location)
  assertEquals(examineActions.length, 4);
  assertEquals(examineActions[0].energyCost, 1);
});

Deno.test("ActionEngine.generateValidActions - excludes EXAMINE when energy < 2", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 1;
  const engine = new ActionEngine(world);

  const actions = engine.generateValidActions("player");

  const examineActions = actions.filter((a) => a.type === "EXAMINE");
  assertEquals(examineActions.length, 0);
});

// ========================================
// Tests for executeAction()
// ========================================

Deno.test("ActionEngine.executeAction - MOVE changes player location", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "MOVE",
    target: "forest",
    description: "Travel to Dark Forest",
    energyCost: 5,
  };

  const result = engine.executeAction("player", action, 1);
  // Note: With transaction pattern, original world is NOT mutated
  // Check the returned world instead
  const originalPlayer = world.entities.find((e) => e.id === "player")!;
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, true);
  assertEquals(originalPlayer.location, "tavern"); // Original unchanged
  assertEquals(newPlayer.location, "forest"); // New world has changes
  assertEquals(newPlayer.energy, 95);
  assertEquals(result.changes.some((c) => c.includes("Moved")), true);
});

Deno.test("ActionEngine.executeAction - TALK records conversation", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "TALK",
    target: "npc",
    description: "Talk to Bartender",
    energyCost: 3,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, true);
  assertEquals(
    result.changes.some((c) => c.includes("conversation")),
    true,
  );
});

Deno.test("ActionEngine.executeAction - TAKE_ITEM moves item to inventory", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "TAKE_ITEM",
    target: "potion",
    description: "Pick up Health Potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;
  const newPotion = result.world.entities.find((e) => e.id === "potion")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.inventory?.includes("potion"), true);
  assertEquals(newPotion.location, "player");
});

Deno.test("ActionEngine.executeAction - DROP_ITEM moves item to location", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["potion"];
  const potion = world.entities.find((e) => e.id === "potion")!;
  potion.location = "player";

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "DROP_ITEM",
    target: "potion",
    description: "Drop Health Potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;
  const newPotion = result.world.entities.find((e) => e.id === "potion")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.inventory?.includes("potion"), false);
  assertEquals(newPotion.location, "tavern");
});

Deno.test("ActionEngine.executeAction - USE_ITEM applies health effect", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 50;
  player.inventory = ["potion"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "potion",
    description: "Use Health Potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.health, 80); // 50 + 30
  assertEquals(
    result.changes.some((c) => c.includes("Health increased")),
    true,
  );
});

Deno.test("ActionEngine.executeAction - USE_ITEM caps health at 100", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 90;
  player.inventory = ["potion"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "potion",
    description: "Use Health Potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.health, 100); // Capped at 100, not 120
});

Deno.test("ActionEngine.executeAction - USE_ITEM removes consumable from world", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["potion"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "potion",
    description: "Use Health Potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.inventory?.includes("potion"), false);
  assertEquals(result.world.entities.find((e) => e.id === "potion"), undefined);
  // After commit, engine is updated with new world - potion should be gone
  assertEquals(engine.getEntity("potion"), undefined);
});

Deno.test("ActionEngine.executeAction - USE_ITEM keeps non-consumable in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = "forest";
  player.inventory = ["sword"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "sword",
    description: "Use Iron Sword",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.inventory?.includes("sword"), true);
  assertEquals(
    result.world.entities.find((e) => e.id === "sword") !== undefined,
    true,
  );
});

Deno.test("ActionEngine.executeAction - USE_ITEM applies negative effects", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["sword"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "sword",
    description: "Use Iron Sword",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.health, 90); // 100 - 10
  assertEquals(newPlayer.energy, 95); // 100 - 5
});

Deno.test("ActionEngine.executeAction - USE_ITEM health doesn't go below 0", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.health = 5;
  player.inventory = ["sword"];

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "sword",
    description: "Use Iron Sword",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.health, 0); // Capped at 0, not -5
});

Deno.test("ActionEngine.executeAction - REST recovers 70 energy", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 20;

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "REST",
    description: "Rest to recover energy",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.energy, 90); // 20 + 70
});

Deno.test("ActionEngine.executeAction - REST caps energy at 100", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 50;

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "REST",
    description: "Rest to recover energy",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(newPlayer.energy, 100); // Capped at 100, not 120
});

Deno.test("ActionEngine.executeAction - WAIT just passes time", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "WAIT",
    description: "Wait and observe",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, true);
  // Note: WAIT doesn't produce changes in transactional model
  assertEquals(result.changes.length, 0);
});

Deno.test("ActionEngine.executeAction - EXPLORE returns exploration message", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "EXPLORE",
    description: "Explore your surroundings",
    energyCost: 4,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.energy, 96); // 100 - 4
  // EXPLORE just reduces energy, discovery handled externally
  assertEquals(result.changes.some((c) => c.includes("Energy")), true);
});

Deno.test("ActionEngine.executeAction - EXAMINE records examination", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "EXAMINE",
    target: "npc",
    description: "Examine Bartender",
    energyCost: 1,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, true);
  assertEquals(result.changes.some((c) => c.includes("Examined")), true);
});

// ========================================
// Tests for getPlayerState()
// ========================================

Deno.test("ActionEngine.getPlayerState - returns player state", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["key"];
  const engine = new ActionEngine(world);

  const state = engine.getPlayerState("player");

  assertEquals(state?.currentLocation, "tavern");
  assertEquals(state?.health, 100);
  assertEquals(state?.energy, 100);
  assertEquals(state?.inventory, ["key"]);
});

Deno.test("ActionEngine.getPlayerState - returns null for invalid player", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const state = engine.getPlayerState("nonexistent");

  assertEquals(state, null);
});

Deno.test("ActionEngine.getPlayerState - returns null for non-person entity", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const state = engine.getPlayerState("tavern");

  assertEquals(state, null);
});

// ========================================
// Tests for getEntity()
// ========================================

Deno.test("ActionEngine.getEntity - returns entity by id", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const entity = engine.getEntity("tavern");

  assertEquals(entity?.name, "The Tavern");
  assertEquals(entity?.type, "place");
});

Deno.test("ActionEngine.getEntity - returns undefined for invalid id", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);

  const entity = engine.getEntity("nonexistent");

  assertEquals(entity, undefined);
});

// ========================================
// Edge case tests - validation and error handling
// ========================================

Deno.test("ActionEngine.executeAction - rejects MOVE to non-existent location", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "MOVE",
    target: "nonexistent_place",
    description: "Travel to nowhere",
    energyCost: 5,
  };

  const result = engine.executeAction("player", action, 1);
  const player = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, false);
  assertEquals(
    result.error,
    "Cannot move to nonexistent_place: not connected.",
  );
  // Player location unchanged
  assertEquals(player.location, "tavern");
});

Deno.test("ActionEngine.executeAction - rejects USE_ITEM for non-existent item", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = ["ghost_item"]; // Item not in world.entities

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "ghost_item",
    description: "Use ghost item",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  // The ghost_item is in inventory array, so validation passes, but
  // when we try to get the item from the world, it throws an error
  assertEquals(result.error, `Invalid item: "ghost_item"`);
});

Deno.test("ActionEngine.executeAction - rejects USE_ITEM when item not in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = []; // Empty inventory

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "USE_ITEM",
    target: "potion",
    description: "Use potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Cannot use item: not in inventory.");
});

Deno.test("ActionEngine.executeAction - energy can go to zero from action cost", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 4; // Exactly enough energy

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "EXPLORE",
    description: "Explore",
    energyCost: 4,
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  assertEquals(result.success, true);
  assertEquals(newPlayer.energy, 0); // 4 - 4 = 0
});

Deno.test("ActionEngine.executeAction - rejects action when energy insufficient", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 3; // Less than required

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "EXPLORE",
    description: "Explore",
    energyCost: 4,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Not enough energy. Need 4, have 3.");
});

Deno.test("ActionEngine.executeAction - large energy cost doesn't go negative", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.energy = 5;

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "MOVE",
    target: "forest",
    description: "Travel far",
    energyCost: 100, // Way more than player has
  };

  const result = engine.executeAction("player", action, 1);
  const newPlayer = result.world.entities.find((e) => e.id === "player")!;

  // With transaction validation, this now fails because not enough energy
  assertEquals(result.success, false);
  assertEquals(result.error, "Not enough energy. Need 100, have 5.");
});

Deno.test("ActionEngine.generateValidActions - handles player with invalid location", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.location = "nonexistent_place";

  const engine = new ActionEngine(world);
  const actions = engine.generateValidActions("player");

  // Should return empty since player's location doesn't exist
  assertEquals(actions.length, 0);
});

Deno.test("ActionEngine.executeAction - rejects DROP_ITEM when item not in inventory", () => {
  const world = createTestWorld();
  const player = world.entities.find((e) => e.id === "player")!;
  player.inventory = []; // Empty inventory

  const engine = new ActionEngine(world);
  const action: Action = {
    type: "DROP_ITEM",
    target: "potion",
    description: "Drop potion",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);
  const potion = result.world.entities.find((e) => e.id === "potion")!;

  assertEquals(result.success, false);
  assertEquals(result.error, "Cannot drop item: not in inventory.");
  // Item location unchanged
  assertEquals(potion.location, "tavern");
});

Deno.test("ActionEngine.executeAction - rejects TALK to non-person", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "TALK",
    target: "tavern", // tavern is a place, not a person
    description: "Talk to tavern",
    energyCost: 3,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Cannot talk to: invalid target.");
});

Deno.test("ActionEngine.executeAction - rejects EXAMINE of non-existent target", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "EXAMINE",
    target: "nonexistent",
    description: "Examine nothing",
    energyCost: 1,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Cannot examine: invalid target.");
});

Deno.test("ActionEngine.executeAction - rejects action for invalid player", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "REST",
    description: "Rest",
    energyCost: 0,
  };

  const result = engine.executeAction("nonexistent_player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid player");
});

Deno.test("ActionEngine.executeAction - rejects TAKE_ITEM for non-item", () => {
  const world = createTestWorld();
  const engine = new ActionEngine(world);
  const action: Action = {
    type: "TAKE_ITEM",
    target: "npc", // npc is a person, not an item
    description: "Take the bartender",
    energyCost: 0,
  };

  const result = engine.executeAction("player", action, 1);

  assertEquals(result.success, false);
  assertEquals(result.error, "Cannot take item: not available.");
});
