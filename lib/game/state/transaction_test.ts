/**
 * Tests for TransactionManager - state immutability and transactions
 *
 * Run with: deno test lib/game/state/transaction_test.ts
 */

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cloneWorld,
  createEnergyChange,
  createHealthChange,
  createInventoryChange,
  createLocationChange,
  createSnapshot,
  TransactionManager,
} from "./transaction.ts";
import type { World } from "../types.ts";

function createTestWorld(): World {
  return {
    world_name: "Test World",
    world_description: "A test world",
    starting_location: "town_square",
    entities: [
      {
        id: "town_square",
        name: "Town Square",
        type: "place",
        description: "The center of town",
        connections: { forest: {} },
      },
      {
        id: "forest",
        name: "Dark Forest",
        type: "place",
        description: "A dark forest",
        connections: { town_square: {} },
      },
      {
        id: "player",
        name: "Hero",
        type: "person",
        description: "The player",
        location: "town_square",
        health: 100,
        energy: 80,
        inventory: [],
      },
      {
        id: "potion",
        name: "Health Potion",
        type: "item",
        description: "Restores health",
        location: "town_square",
        consumable: true,
        effects: { health: 25 },
      },
    ],
  };
}

// ========================================
// Tests for cloneWorld()
// ========================================

Deno.test("cloneWorld - creates independent copy", () => {
  const world = createTestWorld();
  const cloned = cloneWorld(world);

  // Modify clone
  cloned.entities[0].name = "Modified";
  cloned.world_name = "Modified World";

  // Original unchanged
  assertEquals(world.entities[0].name, "Town Square");
  assertEquals(world.world_name, "Test World");
});

Deno.test("cloneWorld - deep clones nested objects", () => {
  const world = createTestWorld();
  const cloned = cloneWorld(world);

  // Modify nested object in clone
  const clonedPlace = cloned.entities.find((e) => e.id === "town_square")!;
  clonedPlace.connections!["new_place"] = {};

  // Original unchanged
  const originalPlace = world.entities.find((e) => e.id === "town_square")!;
  assertEquals(originalPlace.connections!["new_place"], undefined);
});

// ========================================
// Tests for createSnapshot()
// ========================================

Deno.test("createSnapshot - captures state at point in time", () => {
  const world = createTestWorld();
  const snapshot = createSnapshot(world, 5, "test_snapshot");

  assertEquals(snapshot.turn, 5);
  assertEquals(snapshot.label, "test_snapshot");
  assertEquals(snapshot.world.world_name, "Test World");
  assertEquals(typeof snapshot.timestamp, "number");
});

Deno.test("createSnapshot - snapshot is independent of original", () => {
  const world = createTestWorld();
  const snapshot = createSnapshot(world, 1);

  // Modify original
  world.world_name = "Modified";

  // Snapshot unchanged
  assertEquals(snapshot.world.world_name, "Test World");
});

// ========================================
// Tests for TransactionManager
// ========================================

Deno.test("TransactionManager - startTransaction creates transaction", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  const transaction = manager.startTransaction(world, 1);

  assertEquals(typeof transaction.id, "string");
  assertEquals(transaction.committed, false);
  assertEquals(transaction.rolledBack, false);
  assertEquals(transaction.changes.length, 0);
  assertEquals(transaction.preSnapshot.turn, 1);
});

Deno.test("TransactionManager - cannot start transaction while one is active", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);

  assertThrows(
    () => manager.startTransaction(world, 2),
    Error,
    "existing transaction not completed",
  );
});

Deno.test("TransactionManager - can start transaction after commit", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.commit(world);

  // Should not throw
  const transaction2 = manager.startTransaction(world, 2);
  assertEquals(transaction2.preSnapshot.turn, 2);
});

Deno.test("TransactionManager - can start transaction after rollback", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.rollback();

  // Should not throw
  const transaction2 = manager.startTransaction(world, 2);
  assertEquals(transaction2.preSnapshot.turn, 2);
});

Deno.test("TransactionManager - recordChange adds change to transaction", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  const change = manager.recordChange({
    entityId: "player",
    field: "energy",
    oldValue: 80,
    newValue: 70,
    turn: 1,
    description: "Energy decreased",
  });

  assertEquals(typeof change.id, "string");
  assertEquals(change.entityId, "player");
  assertEquals(change.field, "energy");

  const transaction = manager.getCurrentTransaction();
  assertEquals(transaction?.changes.length, 1);
});

Deno.test("TransactionManager - recordChange throws without active transaction", () => {
  const manager = new TransactionManager();

  assertThrows(
    () =>
      manager.recordChange({
        entityId: "player",
        field: "energy",
        oldValue: 80,
        newValue: 70,
        turn: 1,
        description: "Energy decreased",
      }),
    Error,
    "No active transaction",
  );
});

Deno.test("TransactionManager - commit applies changes", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.recordChange({
    entityId: "player",
    field: "energy",
    oldValue: 80,
    newValue: 70,
    turn: 1,
    description: "Energy decreased",
  });

  const newWorld = manager.commit(world);

  const player = newWorld.entities.find((e) => e.id === "player")!;
  assertEquals(player.energy, 70);

  // Original world unchanged
  const originalPlayer = world.entities.find((e) => e.id === "player")!;
  assertEquals(originalPlayer.energy, 80);
});

Deno.test("TransactionManager - commit throws without transaction", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  assertThrows(() => manager.commit(world), Error, "No transaction to commit");
});

Deno.test("TransactionManager - commit throws if already committed", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.commit(world);

  assertThrows(
    () => manager.commit(world),
    Error,
    "Transaction already completed",
  );
});

Deno.test("TransactionManager - rollback restores original state", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.recordChange({
    entityId: "player",
    field: "energy",
    oldValue: 80,
    newValue: 0,
    turn: 1,
    description: "Energy depleted",
  });

  const restoredWorld = manager.rollback();

  const player = restoredWorld.entities.find((e) => e.id === "player")!;
  assertEquals(player.energy, 80);
});

Deno.test("TransactionManager - rollback throws without transaction", () => {
  const manager = new TransactionManager();

  assertThrows(
    () => manager.rollback(),
    Error,
    "No transaction to rollback",
  );
});

Deno.test("TransactionManager - rollback throws if already committed", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.commit(world);

  assertThrows(
    () => manager.rollback(),
    Error,
    "Cannot rollback committed transaction",
  );
});

Deno.test("TransactionManager - multiple changes in single transaction", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);

  // Move player
  manager.recordChange({
    entityId: "player",
    field: "location",
    oldValue: "town_square",
    newValue: "forest",
    turn: 1,
    description: "Moved to forest",
  });

  // Use energy
  manager.recordChange({
    entityId: "player",
    field: "energy",
    oldValue: 80,
    newValue: 75,
    turn: 1,
    description: "Energy used for movement",
  });

  const newWorld = manager.commit(world);
  const player = newWorld.entities.find((e) => e.id === "player")!;

  assertEquals(player.location, "forest");
  assertEquals(player.energy, 75);
});

Deno.test("TransactionManager - getChangeDescriptions returns all descriptions", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.recordChange({
    entityId: "player",
    field: "energy",
    oldValue: 80,
    newValue: 75,
    turn: 1,
    description: "Energy decreased by 5",
  });
  manager.recordChange({
    entityId: "player",
    field: "location",
    oldValue: "town_square",
    newValue: "forest",
    turn: 1,
    description: "Moved to forest",
  });

  const descriptions = manager.getChangeDescriptions();

  assertEquals(descriptions.length, 2);
  assertEquals(descriptions[0], "Energy decreased by 5");
  assertEquals(descriptions[1], "Moved to forest");
});

Deno.test("TransactionManager - handles entity removal", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  manager.startTransaction(world, 1);
  manager.recordChange({
    entityId: "potion",
    field: "__remove_entity__",
    oldValue: world.entities.find((e) => e.id === "potion"),
    newValue: null,
    turn: 1,
    description: "Potion consumed",
  });

  const newWorld = manager.commit(world);

  assertEquals(newWorld.entities.find((e) => e.id === "potion"), undefined);
  assertEquals(newWorld.entities.length, 3);

  // Original unchanged
  assertEquals(
    world.entities.find((e) => e.id === "potion") !== undefined,
    true,
  );
  assertEquals(world.entities.length, 4);
});

Deno.test("TransactionManager - handles entity addition", () => {
  const world = createTestWorld();
  const manager = new TransactionManager();

  const newItem = {
    id: "sword",
    name: "Iron Sword",
    type: "item" as const,
    description: "A sturdy sword",
    location: "forest",
  };

  manager.startTransaction(world, 1);
  manager.recordChange({
    entityId: "sword",
    field: "__new_entity__",
    oldValue: null,
    newValue: newItem,
    turn: 1,
    description: "Found a sword",
  });

  const newWorld = manager.commit(world);

  assertEquals(
    newWorld.entities.find((e) => e.id === "sword")?.name,
    "Iron Sword",
  );
  assertEquals(newWorld.entities.length, 5);

  // Original unchanged
  assertEquals(world.entities.find((e) => e.id === "sword"), undefined);
  assertEquals(world.entities.length, 4);
});

// ========================================
// Tests for convenience functions
// ========================================

Deno.test("createEnergyChange - creates correct change object", () => {
  const change = createEnergyChange("player", 80, 70, 1, "walking");

  assertEquals(change.entityId, "player");
  assertEquals(change.field, "energy");
  assertEquals(change.oldValue, 80);
  assertEquals(change.newValue, 70);
  assertEquals(change.turn, 1);
  assertEquals(change.description.includes("decreased"), true);
  assertEquals(change.description.includes("10"), true);
});

Deno.test("createEnergyChange - handles increase", () => {
  const change = createEnergyChange("player", 50, 80, 1, "resting");

  assertEquals(change.description.includes("increased"), true);
  assertEquals(change.description.includes("30"), true);
});

Deno.test("createHealthChange - creates correct change object", () => {
  const change = createHealthChange("player", 100, 75, 1, "damage");

  assertEquals(change.entityId, "player");
  assertEquals(change.field, "health");
  assertEquals(change.oldValue, 100);
  assertEquals(change.newValue, 75);
  assertEquals(change.description.includes("decreased"), true);
});

Deno.test("createLocationChange - creates correct change object", () => {
  const change = createLocationChange("player", "town_square", "forest", 1);

  assertEquals(change.entityId, "player");
  assertEquals(change.field, "location");
  assertEquals(change.oldValue, "town_square");
  assertEquals(change.newValue, "forest");
  assertEquals(change.description.includes("town_square"), true);
  assertEquals(change.description.includes("forest"), true);
});

Deno.test("createInventoryChange - creates correct add change", () => {
  const change = createInventoryChange(
    "player",
    [],
    ["potion"],
    1,
    "add",
    "Health Potion",
  );

  assertEquals(change.entityId, "player");
  assertEquals(change.field, "inventory");
  assertEquals(change.description.includes("Added"), true);
  assertEquals(change.description.includes("Health Potion"), true);
});

Deno.test("createInventoryChange - creates correct remove change", () => {
  const change = createInventoryChange(
    "player",
    ["potion"],
    [],
    1,
    "remove",
    "Health Potion",
  );

  assertEquals(change.description.includes("Removed"), true);
});
