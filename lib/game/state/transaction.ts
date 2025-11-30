import type {
  Entity,
  StateChange,
  StateTransaction,
  World,
  WorldSnapshot,
} from "../types.ts";

/**
 * Creates a deep copy of a world object.
 * Used for snapshots and immutable updates.
 */
export function cloneWorld(world: World): World {
  return JSON.parse(JSON.stringify(world));
}

/**
 * Creates a snapshot of the current world state.
 */
export function createSnapshot(
  world: World,
  turn: number,
  label?: string,
): WorldSnapshot {
  return {
    timestamp: Date.now(),
    turn,
    world: cloneWorld(world),
    label,
  };
}

/**
 * Manages a transaction for world state changes.
 * Changes are accumulated and can be committed or rolled back.
 */
export class TransactionManager {
  private transaction: StateTransaction | null = null;

  /**
   * Start a new transaction. Must be committed or rolled back before starting another.
   */
  startTransaction(world: World, turn: number): StateTransaction {
    if (
      this.transaction && !this.transaction.committed &&
      !this.transaction.rolledBack
    ) {
      throw new Error(
        "Cannot start transaction: existing transaction not completed",
      );
    }

    this.transaction = {
      id: crypto.randomUUID(),
      preSnapshot: createSnapshot(world, turn, "pre_transaction"),
      changes: [],
      committed: false,
      rolledBack: false,
    };

    return this.transaction;
  }

  /**
   * Get the current active transaction.
   */
  getCurrentTransaction(): StateTransaction | null {
    return this.transaction;
  }

  /**
   * Record a change in the current transaction.
   * Does NOT apply the change to the world yet.
   */
  recordChange(change: Omit<StateChange, "id">): StateChange {
    if (
      !this.transaction || this.transaction.committed ||
      this.transaction.rolledBack
    ) {
      throw new Error("No active transaction");
    }

    const fullChange: StateChange = {
      ...change,
      id: crypto.randomUUID(),
    };

    this.transaction.changes.push(fullChange);
    return fullChange;
  }

  /**
   * Apply all accumulated changes to the world and mark transaction as committed.
   * Returns the modified world (new reference).
   */
  commit(world: World): World {
    if (!this.transaction) {
      throw new Error("No transaction to commit");
    }
    if (this.transaction.committed || this.transaction.rolledBack) {
      throw new Error("Transaction already completed");
    }

    // Create a new world with changes applied
    const newWorld = cloneWorld(world);

    for (const change of this.transaction.changes) {
      applyChange(newWorld, change);
    }

    this.transaction.committed = true;
    return newWorld;
  }

  /**
   * Discard all changes and return the pre-transaction world state.
   */
  rollback(): World {
    if (!this.transaction) {
      throw new Error("No transaction to rollback");
    }
    if (this.transaction.committed) {
      throw new Error("Cannot rollback committed transaction");
    }

    this.transaction.rolledBack = true;
    return cloneWorld(this.transaction.preSnapshot.world);
  }

  /**
   * Get human-readable descriptions of all changes for narration.
   */
  getChangeDescriptions(): string[] {
    if (!this.transaction) return [];
    return this.transaction.changes.map((c) => c.description);
  }
}

/**
 * Apply a single change to a world object (mutates in place).
 * Supports nested field access via dot notation.
 */
function applyChange(world: World, change: StateChange): void {
  // Special case: removing an entity - check BEFORE looking for entity
  if (change.field === "__remove_entity__") {
    const index = world.entities.findIndex((e) => e.id === change.entityId);
    if (index !== -1) {
      world.entities.splice(index, 1);
    }
    return;
  }

  // Special case: adding a new entity
  if (change.field === "__new_entity__" && change.newValue) {
    world.entities.push(change.newValue as Entity);
    return;
  }

  const entity = world.entities.find((e) => e.id === change.entityId);
  if (!entity) {
    throw new Error(`Entity not found: "${change.entityId}"`);
  }

  // Handle nested field access (e.g., "connections.forest_clearing")
  const parts = change.field.split(".");
  // deno-lint-ignore no-explicit-any
  let target: any = entity;

  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]];
    if (target === undefined || target === null) {
      throw new Error(`Invalid field path: "${change.field}"`);
    }
  }

  const finalField = parts[parts.length - 1];
  target[finalField] = change.newValue;
}

/**
 * Convenience function to create a change for energy modification.
 */
export function createEnergyChange(
  entityId: string,
  oldEnergy: number,
  newEnergy: number,
  turn: number,
  reason: string,
): Omit<StateChange, "id"> {
  return {
    entityId,
    field: "energy",
    oldValue: oldEnergy,
    newValue: newEnergy,
    turn,
    description: `Energy ${
      newEnergy > oldEnergy ? "increased" : "decreased"
    } by ${Math.abs(newEnergy - oldEnergy)} (${reason}). Now ${newEnergy}/100.`,
  };
}

/**
 * Convenience function to create a change for health modification.
 */
export function createHealthChange(
  entityId: string,
  oldHealth: number,
  newHealth: number,
  turn: number,
  reason: string,
): Omit<StateChange, "id"> {
  return {
    entityId,
    field: "health",
    oldValue: oldHealth,
    newValue: newHealth,
    turn,
    description: `Health ${
      newHealth > oldHealth ? "increased" : "decreased"
    } by ${Math.abs(newHealth - oldHealth)} (${reason}). Now ${newHealth}/100.`,
  };
}

/**
 * Convenience function to create a change for location modification.
 */
export function createLocationChange(
  entityId: string,
  oldLocation: string,
  newLocation: string,
  turn: number,
): Omit<StateChange, "id"> {
  return {
    entityId,
    field: "location",
    oldValue: oldLocation,
    newValue: newLocation,
    turn,
    description: `Moved from ${oldLocation} to ${newLocation}.`,
  };
}

/**
 * Convenience function to create a change for inventory modification.
 */
export function createInventoryChange(
  entityId: string,
  oldInventory: string[],
  newInventory: string[],
  turn: number,
  action: "add" | "remove",
  itemId: string,
): Omit<StateChange, "id"> {
  return {
    entityId,
    field: "inventory",
    oldValue: oldInventory,
    newValue: newInventory,
    turn,
    description: action === "add"
      ? `Added ${itemId} to inventory.`
      : `Removed ${itemId} from inventory.`,
  };
}
