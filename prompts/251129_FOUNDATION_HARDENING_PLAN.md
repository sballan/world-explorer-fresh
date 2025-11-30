# Foundation Hardening Plan

> **Deno Style Guide Compliance**
>
> This document follows
> [Deno's official style guide](https://docs.deno.com/runtime/contributing/style_guide/):
>
> - **`mod.ts`** instead of `index.ts` for module entry points
> - **`snake_case`** for filenames (e.g., `kv_session_manager.ts`)
> - **`*_test.ts`** suffix for test files (e.g., `transaction_test.ts`)
> - **Underscore prefix** for internal modules (e.g., `_testing/`)
> - **Top-level `function`** keyword instead of arrow functions
> - **JSDoc** on all exported symbols
> - **Max 2 required args** plus optional options object for exported functions
>
> Note: The existing codebase uses some non-Deno conventions (e.g., `index.ts`,
> `*.test.ts`). When implementing this plan, you may choose to:
>
> 1. Follow existing conventions for consistency with current code
> 2. Migrate to Deno conventions as part of the refactor
>
> This document uses Deno conventions. Adjust as needed for your codebase.

## Overview

This document describes the preparatory work required before implementing the
scene/day context management architecture described in
`251129_CONTEXT_MANAGEMENT_DESIGN.md`. The current codebase has several
architectural weaknesses that would make the scene/day implementation fragile,
difficult to test, and prone to bugs.

**This plan should be executed BEFORE the scene/day implementation.**

---

## Current State Assessment

### Critical Issues Identified

| Issue                         | Location                       | Impact on Scene/Day Architecture                |
| ----------------------------- | ------------------------------ | ----------------------------------------------- |
| Direct state mutation         | `engine.ts:200-388`            | Cannot snapshot state at scene boundaries       |
| No rollback capability        | `engine.ts`, `game-service.ts` | Cannot recover from failed LLM calls mid-action |
| 24-hour session TTL           | `kv-session-manager.ts:33`     | Long-running games will lose all progress       |
| TTL not extended on activity  | `kv-session-manager.ts`        | Active games still expire                       |
| Duplicated context extraction | All LLM services               | Cannot build scene-aware context consistently   |
| No token counting             | Entire codebase                | Cannot implement energy-as-tokens mechanic      |
| Duplicated cookie parsing     | Route handlers                 | Will get worse with more endpoints              |
| Duplicated test utilities     | Test files                     | Cannot efficiently test new systems             |

### Files That Will Be Modified

> **Deno Conventions Note**: This project follows Deno style guide conventions:
>
> - Use `mod.ts` instead of `index.ts` for module entry points
> - Use `snake_case` for filenames (e.g., `kv_session_manager.ts`)
> - Test files use `*_test.ts` suffix (e.g., `transaction_test.ts`)
> - Prefix internal/unstable modules with underscore (e.g., `_internal.ts`)
> - Top-level functions use `function` keyword, not arrow functions
> - All exported symbols should have JSDoc documentation
>
> See: https://docs.deno.com/runtime/contributing/style_guide/

```
lib/game/
├── engine.ts                    # State mutation patterns
├── game_service.ts              # Orchestration, history management
├── types.ts                     # New interfaces for transactions, context
├── session/
│   ├── interface.ts
│   ├── kv_session_manager.ts    # TTL handling
│   ├── mock_session_manager.ts  # NEW: Mock impl (colocated with interface)
│   ├── utils.ts                 # NEW: Session extraction utilities
│   └── mod.ts                   # Exports real + mock implementations
├── llm/
│   ├── context/                 # NEW: Context building utilities
│   │   ├── builder.ts
│   │   ├── tokens.ts
│   │   └── mod.ts               # Module entry point (NOT index.ts)
│   ├── client/
│   │   ├── interface.ts
│   │   ├── cloud_client.ts
│   │   ├── local_client.ts
│   │   ├── mock_client.ts       # Already exists (colocated with interface)
│   │   └── mod.ts
│   ├── services/
│   │   ├── interface.ts
│   │   ├── narrator.ts          # Refactor to use context builder
│   │   ├── action_selector.ts   # Refactor to use context builder
│   │   ├── discovery_generator.ts # Refactor to use context builder
│   │   ├── world_generator.ts
│   │   ├── mock_narrator.ts     # NEW: Mock impl (colocated with interface)
│   │   ├── mock_action_selector.ts    # NEW: Mock impl
│   │   ├── mock_discovery_generator.ts # NEW: Mock impl
│   │   ├── mock_world_generator.ts    # NEW: Mock impl
│   │   └── mod.ts               # Exports real + mock implementations
│   └── mod.ts
├── state/                       # NEW: State management
│   ├── transaction.ts
│   ├── snapshot.ts
│   └── mod.ts                   # Module entry point (NOT index.ts)
└── _testing/                    # Shared test utilities (underscore = internal)
    ├── builders.ts              # TestWorldBuilder, TestSessionBuilder, etc.
    └── mod.ts                   # NO mocks here - just builders/fixtures

routes/api/game/
├── action.ts                    # Use session utilities
├── status.ts                    # Use session utilities
├── select-character.ts          # Use session utilities
└── init.ts                      # Use session utilities
```

> **Mock Organization Strategy (Hybrid Approach)**
>
> | Type                                                   | Location                 | Rationale                                  |
> | ------------------------------------------------------ | ------------------------ | ------------------------------------------ |
> | Interface implementations (e.g., `MockSessionManager`) | Colocated with interface | Valid implementation, exported from module |
> | Test data builders (e.g., `TestWorldBuilder`)          | Centralized `_testing/`  | Shared across many test files              |
>
> **Colocate mocks if** they implement an interface from that module.
> **Centralize utilities if** they're pure test infrastructure (builders,
> fixtures).

---

## Phase 0.1: State Immutability and Transactions

### Problem Statement

The current `ActionEngine.executeAction()` method directly mutates entity
objects:

```typescript
// Current pattern in engine.ts (PROBLEMATIC)
player.energy = Math.max(0, player.energy! - action.energyCost);
player.location = action.target!;
player.inventory!.push(action.target!);
this.world.entities.splice(index, 1); // Destroys consumables
```

This creates several problems:

1. **No snapshots**: Cannot capture world state at a point in time
2. **No rollback**: If narration fails after mutation, state is corrupted
3. **No change tracking**: `changes[]` array is just strings for narration
4. **Cache invalidation**: `entityMap` cache can diverge from `world.entities`

### Solution: Transaction Pattern

Introduce a transaction-based state update pattern where:

1. Changes are computed but not applied
2. Changes are validated
3. Changes are applied atomically
4. Rollback is possible if downstream operations fail

### New Type Definitions

Add to `lib/game/types.ts`:

```typescript
/**
 * Represents a single atomic change to an entity's state.
 * Used for tracking, rollback, and narration.
 */
export interface StateChange {
  /** Unique ID for this change */
  id: string;

  /** The entity being modified */
  entityId: string;

  /** The field being changed (supports dot notation for nested fields) */
  field: string;

  /** Value before the change */
  oldValue: unknown;

  /** Value after the change */
  newValue: unknown;

  /** Turn number when this change occurred */
  turn: number;

  /** Human-readable description for narration */
  description: string;
}

/**
 * A snapshot of the complete world state at a point in time.
 * Used for rollback and scene boundary captures.
 */
export interface WorldSnapshot {
  /** When this snapshot was taken */
  timestamp: number;

  /** Turn number at snapshot time */
  turn: number;

  /** Deep copy of world state */
  world: World;

  /** Optional label (e.g., "scene_start", "pre_action") */
  label?: string;
}

/**
 * Represents a pending set of changes that can be committed or rolled back.
 */
export interface StateTransaction {
  /** Unique transaction ID */
  id: string;

  /** Snapshot taken before transaction started */
  preSnapshot: WorldSnapshot;

  /** Accumulated changes in this transaction */
  changes: StateChange[];

  /** Whether transaction has been committed */
  committed: boolean;

  /** Whether transaction has been rolled back */
  rolledBack: boolean;
}
```

### New Module: `lib/game/state/transaction.ts`

```typescript
import {
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
  const entity = world.entities.find((e) => e.id === change.entityId);
  if (!entity) {
    // Special case: adding a new entity
    if (change.field === "__new_entity__" && change.newValue) {
      world.entities.push(change.newValue as Entity);
      return;
    }
    // Special case: removing an entity
    if (change.field === "__remove_entity__") {
      const index = world.entities.findIndex((e) => e.id === change.entityId);
      if (index !== -1) {
        world.entities.splice(index, 1);
      }
      return;
    }
    throw new Error(`Entity not found: ${change.entityId}`);
  }

  // Handle nested field access (e.g., "connections.forest_clearing")
  const parts = change.field.split(".");
  let target: Record<string, unknown> = entity as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]] as Record<string, unknown>;
    if (!target) {
      throw new Error(`Invalid field path: ${change.field}`);
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
```

### New Module: `lib/game/state/mod.ts`

```typescript
// lib/game/state/mod.ts
// Module entry point for state management utilities.
// Deno convention: use mod.ts instead of index.ts

export * from "./transaction.ts";
```

### Refactored `engine.ts`

The `ActionEngine` needs to be refactored to use transactions. Here's the
pattern:

```typescript
// lib/game/engine.ts - REFACTORED VERSION

import { Action, ActionResult, Entity, GameState, World } from "./types.ts";
import {
  createEnergyChange,
  createHealthChange,
  createInventoryChange,
  createLocationChange,
  TransactionManager,
} from "./state/mod.ts";

export class ActionEngine {
  private world: World;
  private entityMap: Map<string, Entity>;
  private transactionManager: TransactionManager;

  constructor(world: World) {
    // Store a CLONE, not the original
    this.world = JSON.parse(JSON.stringify(world));
    this.entityMap = new Map(this.world.entities.map((e) => [e.id, e]));
    this.transactionManager = new TransactionManager();
  }

  /**
   * Execute an action using transaction pattern.
   * Returns the new world state (or original if action invalid).
   */
  executeAction(action: Action, playerId: string, turn: number): ActionResult {
    const player = this.entityMap.get(playerId);
    if (!player || player.type !== "person") {
      return {
        success: false,
        world: this.world,
        changes: [],
        error: "Invalid player",
      };
    }

    // Start transaction
    const transaction = this.transactionManager.startTransaction(
      this.world,
      turn,
    );

    try {
      // Validate action is still possible
      const validationError = this.validateAction(action, player);
      if (validationError) {
        this.transactionManager.rollback();
        return {
          success: false,
          world: this.world,
          changes: [],
          error: validationError,
        };
      }

      // Record energy cost (if any)
      if (action.energyCost > 0) {
        const newEnergy = Math.max(0, player.energy! - action.energyCost);
        this.transactionManager.recordChange(
          createEnergyChange(
            playerId,
            player.energy!,
            newEnergy,
            turn,
            action.type,
          ),
        );
      }

      // Execute action-specific logic
      switch (action.type) {
        case "MOVE":
          this.recordMoveChanges(player, action, turn);
          break;
        case "TAKE_ITEM":
          this.recordTakeItemChanges(player, action, turn);
          break;
        case "DROP_ITEM":
          this.recordDropItemChanges(player, action, turn);
          break;
        case "USE_ITEM":
          this.recordUseItemChanges(player, action, turn);
          break;
        case "REST":
          this.recordRestChanges(player, turn);
          break;
          // ... other action types
      }

      // Commit transaction and get new world
      const newWorld = this.transactionManager.commit(this.world);
      const changes = this.transactionManager.getChangeDescriptions();

      // Update internal state for subsequent operations
      this.world = newWorld;
      this.entityMap = new Map(this.world.entities.map((e) => [e.id, e]));

      return {
        success: true,
        world: newWorld,
        changes,
      };
    } catch (error) {
      // Rollback on any error
      const originalWorld = this.transactionManager.rollback();
      return {
        success: false,
        world: originalWorld,
        changes: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private recordMoveChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    this.transactionManager.recordChange(
      createLocationChange(player.id, player.location!, action.target!, turn),
    );
  }

  private recordTakeItemChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    const item = this.entityMap.get(action.target!);
    if (!item) throw new Error(`Item not found: ${action.target}`);

    // Update item location
    this.transactionManager.recordChange({
      entityId: item.id,
      field: "location",
      oldValue: item.location,
      newValue: undefined,
      turn,
      description: `${item.name} picked up.`,
    });

    // Update player inventory
    const newInventory = [...(player.inventory || []), item.id];
    this.transactionManager.recordChange(
      createInventoryChange(
        player.id,
        player.inventory || [],
        newInventory,
        turn,
        "add",
        item.id,
      ),
    );
  }

  private recordDropItemChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    const item = this.entityMap.get(action.target!);
    if (!item) throw new Error(`Item not found: ${action.target}`);

    // Update item location to player's current location
    this.transactionManager.recordChange({
      entityId: item.id,
      field: "location",
      oldValue: undefined,
      newValue: player.location,
      turn,
      description: `${item.name} dropped.`,
    });

    // Update player inventory
    const newInventory = (player.inventory || []).filter((id) =>
      id !== item.id
    );
    this.transactionManager.recordChange(
      createInventoryChange(
        player.id,
        player.inventory || [],
        newInventory,
        turn,
        "remove",
        item.id,
      ),
    );
  }

  private recordUseItemChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    const item = this.entityMap.get(action.target!);
    if (!item || item.type !== "item") {
      throw new Error(`Invalid item: ${action.target}`);
    }

    // Apply item effects
    if (item.effects?.health) {
      const newHealth = Math.max(
        0,
        Math.min(100, player.health! + item.effects.health),
      );
      this.transactionManager.recordChange(
        createHealthChange(
          player.id,
          player.health!,
          newHealth,
          turn,
          `used ${item.name}`,
        ),
      );
    }

    if (item.effects?.energy) {
      const newEnergy = Math.max(
        0,
        Math.min(100, player.energy! + item.effects.energy),
      );
      this.transactionManager.recordChange(
        createEnergyChange(
          player.id,
          player.energy!,
          newEnergy,
          turn,
          `used ${item.name}`,
        ),
      );
    }

    // Remove consumable items
    if (item.consumable) {
      // Remove from inventory
      const newInventory = (player.inventory || []).filter((id) =>
        id !== item.id
      );
      this.transactionManager.recordChange(
        createInventoryChange(
          player.id,
          player.inventory || [],
          newInventory,
          turn,
          "remove",
          item.id,
        ),
      );

      // Mark entity as removed
      this.transactionManager.recordChange({
        entityId: item.id,
        field: "__remove_entity__",
        oldValue: item,
        newValue: null,
        turn,
        description: `${item.name} consumed.`,
      });
    }
  }

  private recordRestChanges(player: Entity, turn: number): void {
    const newEnergy = Math.min(100, player.energy! + 30);
    this.transactionManager.recordChange(
      createEnergyChange(player.id, player.energy!, newEnergy, turn, "resting"),
    );
  }

  private validateAction(action: Action, player: Entity): string | null {
    // Check energy
    if (player.energy! < action.energyCost) {
      return `Not enough energy. Need ${action.energyCost}, have ${player.energy}.`;
    }

    // Action-specific validation...
    switch (action.type) {
      case "MOVE": {
        const location = this.entityMap.get(player.location!);
        if (!location?.connections?.[action.target!]) {
          return `Cannot move to ${action.target}: not connected.`;
        }
        break;
      }
      case "TAKE_ITEM": {
        const item = this.entityMap.get(action.target!);
        if (
          !item || item.type !== "item" || item.location !== player.location
        ) {
          return `Cannot take item: not available.`;
        }
        break;
      }
        // ... other validations
    }

    return null;
  }

  // ... rest of ActionEngine methods (generateValidActions, etc.)
}

export interface ActionResult {
  success: boolean;
  world: World;
  changes: string[];
  error?: string;
}
```

### Integration with GameService

The `GameService.performAction()` method needs to be updated to:

1. Use transaction-based engine
2. Only persist state if narration succeeds
3. Rollback on any failure

```typescript
// In game-service.ts - performAction method

async performAction(sessionId: string, action: Action): Promise<GameActionResponse> {
  const session = await this.sessionManager.getSession(sessionId);
  if (!session?.currentGameState) {
    throw new Error("No active game");
  }

  const gameState = session.currentGameState;
  const engine = new ActionEngine(gameState.world);

  // Execute action (transactional - can rollback)
  const result = engine.executeAction(action, gameState.playerId, gameState.currentTurn);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      narration: "",
      availableActions: engine.generateValidActions(gameState.playerId),
      gameState: {
        health: /* current */,
        energy: /* current */,
        location: /* current */,
        turn: gameState.currentTurn,
      },
    };
  }

  // Try to generate narration
  let narration: string;
  try {
    narration = await this.narrator.narrateAction(
      result.world,
      action,
      result.changes,
      gameState.playerId,
      gameState.messageHistory
    );
  } catch (error) {
    // Narration failed - we already have the new world from transaction
    // Use fallback narration but keep the state changes
    narration = `You ${action.description}. ${result.changes.join(" ")}`;
  }

  // Update game state with new world
  const newGameState: GameState = {
    ...gameState,
    world: result.world,
    currentTurn: gameState.currentTurn + 1,
    messageHistory: [
      ...gameState.messageHistory,
      { role: "user", content: `Player action: ${action.description}` },
      { role: "assistant", content: narration },
    ],
  };

  // Truncate history if needed
  if (newGameState.messageHistory.length > 20) {
    newGameState.messageHistory = [
      newGameState.messageHistory[0],
      ...newGameState.messageHistory.slice(-10),
    ];
  }

  // Persist
  await this.sessionManager.updateGameState(sessionId, newGameState);

  // Generate next actions
  const newEngine = new ActionEngine(result.world);
  const availableActions = await this.actionSelector.selectInterestingActions(
    result.world,
    gameState.playerId,
    newGameState.messageHistory,
    newEngine.generateValidActions(gameState.playerId)
  );

  return {
    success: true,
    narration,
    availableActions,
    gameState: {
      health: /* from new world */,
      energy: /* from new world */,
      location: /* from new world */,
      turn: newGameState.currentTurn,
    },
  };
}
```

### Testing the Transaction System

Create `lib/game/state/transaction_test.ts` (Deno convention: `*_test.ts` not
`*.test.ts`):

```typescript
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cloneWorld,
  createSnapshot,
  TransactionManager,
} from "./transaction.ts";
import { World } from "../types.ts";

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
        connections: { "forest": {} },
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

Deno.test("cloneWorld - creates independent copy", () => {
  const world = createTestWorld();
  const cloned = cloneWorld(world);

  // Modify clone
  cloned.entities[0].name = "Modified";

  // Original unchanged
  assertEquals(world.entities[0].name, "Town Square");
});

Deno.test("createSnapshot - captures state at point in time", () => {
  const world = createTestWorld();
  const snapshot = createSnapshot(world, 5, "test_snapshot");

  assertEquals(snapshot.turn, 5);
  assertEquals(snapshot.label, "test_snapshot");
  assertEquals(snapshot.world.world_name, "Test World");

  // Modify original
  world.world_name = "Modified";

  // Snapshot unchanged
  assertEquals(snapshot.world.world_name, "Test World");
});
```

---

## Phase 0.2: Session TTL Extension

### Problem Statement

Sessions have a hard 24-hour TTL that is never extended:

```typescript
// kv-session-manager.ts line 33
{
  expireIn: 24 * 60 * 60 * 1000;
}
```

The `lastActivity` timestamp is updated but never used to extend the TTL.

### Solution

Extend TTL on every `saveSession()` call using a sliding window approach.

### Updated `kv-session-manager.ts`

```typescript
// lib/game/session/kv-session-manager.ts

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for long-running games
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export class KvSessionManager implements ISessionManager {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  async createSession(worldDescription: string): Promise<SessionData> {
    const sessionData: SessionData = {
      sessionId: crypto.randomUUID(),
      worldDescription,
      generatedWorld: null,
      openingScene: null,
      currentGameState: null,
      currentTurn: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(), // NEW: Track creation time
    };

    await this.kv.set(
      ["sessions", sessionData.sessionId],
      sessionData,
      { expireIn: SESSION_TTL_MS },
    );

    return sessionData;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const entry = await this.kv.get<SessionData>(["sessions", sessionId]);

    if (!entry.value) {
      return null;
    }

    // Extend TTL on read (sliding window)
    await this.touchSession(sessionId, entry.value);

    return entry.value;
  }

  /**
   * Extend session TTL without modifying data.
   * Called on every read to implement sliding window expiry.
   */
  private async touchSession(
    sessionId: string,
    data: SessionData,
  ): Promise<void> {
    data.lastActivity = Date.now();
    await this.kv.set(
      ["sessions", sessionId],
      data,
      { expireIn: SESSION_TTL_MS },
    );
  }

  async saveSession(sessionData: SessionData): Promise<void> {
    sessionData.lastActivity = Date.now();
    await this.kv.set(
      ["sessions", sessionData.sessionId],
      sessionData,
      { expireIn: SESSION_TTL_MS }, // Always extend TTL on save
    );
  }

  // ... other methods updated similarly
}

// Export constants for use in route handlers
export { SESSION_COOKIE_MAX_AGE };
```

### Update Cookie Max-Age in Route Handlers

```typescript
// routes/api/game/init.ts

import { SESSION_COOKIE_MAX_AGE } from "../../../lib/game/session/kv-session-manager.ts";

// In handler:
headers: {
  "Set-Cookie": `game-session=${result.sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE}`,
}
```

### Update SessionData Type

```typescript
// lib/game/types.ts

export interface SessionData {
  sessionId: string;
  worldDescription: string;
  generatedWorld: World | null;
  openingScene: string | null;
  currentGameState: GameState | null;
  currentTurn: number;
  lastActivity: number;
  createdAt: number; // NEW: Track when session was first created
}
```

---

## Phase 0.3: Context Builder Abstraction

### Problem Statement

Every LLM service duplicates context extraction logic:

```typescript
// Repeated in narrator.ts, action-selector.ts, discovery-generator.ts
const player = world.entities.find((e) => e.id === playerId)!;
const location = world.entities.find((e) => e.id === player.location)!;
```

### Solution

Create a `ContextBuilder` module with reusable context building functions.

### New Module: `lib/game/llm/context/builder.ts`

```typescript
import { Entity, Message, World } from "../../types.ts";

/**
 * Builds context strings for LLM prompts.
 * Provides consistent formatting across all LLM services.
 */
export class ContextBuilder {
  /**
   * Get player entity from world.
   */
  static getPlayer(world: World, playerId: string): Entity {
    const player = world.entities.find((e) => e.id === playerId);
    if (!player || player.type !== "person") {
      throw new Error(`Player not found: ${playerId}`);
    }
    return player;
  }

  /**
   * Get location entity from world.
   */
  static getLocation(world: World, locationId: string): Entity {
    const location = world.entities.find((e) => e.id === locationId);
    if (!location || location.type !== "place") {
      throw new Error(`Location not found: ${locationId}`);
    }
    return location;
  }

  /**
   * Get entity by ID.
   */
  static getEntity(world: World, entityId: string): Entity | undefined {
    return world.entities.find((e) => e.id === entityId);
  }

  /**
   * Get all entities at a specific location.
   */
  static getEntitiesAtLocation(world: World, locationId: string): Entity[] {
    return world.entities.filter(
      (e) => e.type !== "place" && e.location === locationId,
    );
  }

  /**
   * Get connected places from a location.
   */
  static getConnectedPlaces(world: World, locationId: string): Entity[] {
    const location = this.getLocation(world, locationId);
    const connectionIds = Object.keys(location.connections || {});
    return connectionIds
      .map((id) => world.entities.find((e) => e.id === id))
      .filter((e): e is Entity => e !== undefined && e.type === "place");
  }

  /**
   * Build player status context string.
   */
  static buildPlayerStatus(player: Entity): string {
    return `Player Status: Health ${player.health ?? 100}/100, Energy ${
      player.energy ?? 100
    }/100`;
  }

  /**
   * Build location context string.
   */
  static buildLocationContext(location: Entity): string {
    return `Current Location: ${location.name}\nDescription: ${location.description}`;
  }

  /**
   * Build full location context with entities present.
   */
  static buildFullLocationContext(world: World, locationId: string): string {
    const location = this.getLocation(world, locationId);
    const entities = this.getEntitiesAtLocation(world, locationId);

    const parts = [
      `Location: ${location.name}`,
      `Description: ${location.description}`,
    ];

    const people = entities.filter((e) => e.type === "person");
    const items = entities.filter((e) => e.type === "item");

    if (people.length > 0) {
      parts.push(`People here: ${people.map((p) => p.name).join(", ")}`);
    }

    if (items.length > 0) {
      parts.push(`Items here: ${items.map((i) => i.name).join(", ")}`);
    }

    const connected = this.getConnectedPlaces(world, locationId);
    if (connected.length > 0) {
      parts.push(`Exits: ${connected.map((c) => c.name).join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * Build inventory context string.
   */
  static buildInventoryContext(world: World, player: Entity): string {
    if (!player.inventory || player.inventory.length === 0) {
      return "Inventory: Empty";
    }

    const items = player.inventory
      .map((id) => this.getEntity(world, id))
      .filter((e): e is Entity => e !== undefined);

    return `Inventory: ${items.map((i) => i.name).join(", ")}`;
  }

  /**
   * Build context for an action being performed.
   */
  static buildActionContext(
    world: World,
    playerId: string,
    actionDescription: string,
    changes: string[],
    targetId?: string,
  ): string {
    const player = this.getPlayer(world, playerId);
    const location = this.getLocation(world, player.location!);

    const parts = [
      `Action Taken: ${actionDescription}`,
      this.buildLocationContext(location),
      this.buildPlayerStatus(player),
    ];

    if (changes.length > 0) {
      parts.push(`Changes: ${changes.join("; ")}`);
    }

    if (targetId) {
      const target = this.getEntity(world, targetId);
      if (target) {
        parts.push(`Target: ${target.name} - ${target.description}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Build context for discovery generation.
   */
  static buildDiscoveryContext(world: World, playerId: string): string {
    const player = this.getPlayer(world, playerId);
    const location = this.getLocation(world, player.location!);
    const entities = this.getEntitiesAtLocation(world, player.location!);
    const connected = this.getConnectedPlaces(world, player.location!);

    return [
      `Current Location: ${location.name}`,
      `Location Description: ${location.description}`,
      `Entities here: ${
        entities.map((e) => `${e.name} (${e.type})`).join(", ") || "None"
      }`,
      `Connected places: ${connected.map((c) => c.name).join(", ") || "None"}`,
      `World theme: ${world.world_description}`,
    ].join("\n");
  }

  /**
   * Build context for action selection.
   */
  static buildActionSelectionContext(
    world: World,
    playerId: string,
    availableActions: string[],
  ): string {
    const player = this.getPlayer(world, playerId);
    const location = this.getLocation(world, player.location!);

    return [
      `Current Location: ${location.name}`,
      this.buildPlayerStatus(player),
      `Available Actions: ${availableActions.join(", ")}`,
    ].join("\n");
  }

  /**
   * Extract recent messages for context.
   * @param messages Full message history
   * @param count Number of recent messages to include
   */
  static getRecentMessages(messages: Message[], count: number = 5): Message[] {
    return messages.slice(-count);
  }

  /**
   * Build a complete prompt with context and instruction.
   */
  static buildPrompt(context: string, instruction: string): string {
    return `${instruction}\n\nContext:\n${context}`;
  }
}
```

### New Module: `lib/game/llm/context/mod.ts`

```typescript
// lib/game/llm/context/mod.ts
// Module entry point for LLM context utilities.
// Deno convention: use mod.ts instead of index.ts

export * from "./builder.ts";
export * from "./tokens.ts";
```

### Refactored LLM Services

Example refactoring for `narrator.ts`:

```typescript
// lib/game/llm/services/narrator.ts - REFACTORED

import { INarrator } from "./interface.ts";
import { ILLMClient } from "../client/interface.ts";
import { CloudLLMClient } from "../client/cloud-client.ts";
import { Action, Entity, Message, World } from "../../types.ts";
import { ContextBuilder } from "../context/mod.ts";

const FAST_MODEL = "gpt-oss:20b-cloud";

export class LLMNarrator implements INarrator {
  private client: ILLMClient;

  constructor(client?: ILLMClient) {
    this.client = client ?? new CloudLLMClient();
  }

  async narrateAction(
    world: World,
    action: Action,
    changes: string[],
    playerId: string,
    messageHistory: Message[],
  ): Promise<string> {
    // Use ContextBuilder instead of manual extraction
    const context = ContextBuilder.buildActionContext(
      world,
      playerId,
      action.description,
      changes,
      action.target,
    );

    const instruction =
      `Narrate what happened when the player performed this action.
Be vivid but concise (1-3 sentences).
Focus on the immediate experience and any interesting details.
Do not repeat the action description verbatim.`;

    const prompt = ContextBuilder.buildPrompt(context, instruction);
    const recentMessages = ContextBuilder.getRecentMessages(messageHistory, 5);

    try {
      const response = await this.client.chat({
        model: FAST_MODEL,
        messages: [
          ...recentMessages,
          { role: "user", content: prompt },
        ],
      });

      return response.message.content;
    } catch (error) {
      console.error("Narration failed:", error);
      // Fallback narration
      return `You ${action.description}. ${changes.join(" ")}`;
    }
  }
}
```

Similar refactoring applies to `action-selector.ts` and
`discovery-generator.ts`.

---

## Phase 0.4: Token Estimation

### Problem Statement

There is no token counting in the codebase. The `slice(-5)` pattern assumes all
messages are equal size, which is incorrect.

### Solution

Add a simple token estimator that can be used for:

1. Truncating message history to fit context limits
2. Calculating energy cost based on token usage (for scene/day system)
3. Validating prompts don't exceed model limits

### New Module: `lib/game/llm/context/tokens.ts`

```typescript
import { Message } from "../../types.ts";

/**
 * Model context limits (approximate).
 * These are conservative estimates to leave room for response.
 */
const MODEL_LIMITS: Record<string, number> = {
  "gpt-oss:20b-cloud": 4096,
  "gpt-oss:120b-cloud": 8192,
  "gemma3:4b": 2048,
  "default": 4096,
};

/**
 * Token estimation utilities.
 * Uses a simple character-based approximation (4 chars ≈ 1 token).
 * This is accurate enough for budget planning, not for billing.
 */
export class TokenEstimator {
  /**
   * Estimate token count for a string.
   * Uses the approximation that 1 token ≈ 4 characters.
   */
  static estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate tokens for a message (includes role overhead).
   */
  static estimateMessage(message: Message): number {
    // ~4 tokens overhead for role and formatting
    return this.estimate(message.content) + 4;
  }

  /**
   * Estimate total tokens for an array of messages.
   */
  static estimateMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessage(msg), 0);
  }

  /**
   * Get the context limit for a model.
   */
  static getModelLimit(model: string): number {
    return MODEL_LIMITS[model] ?? MODEL_LIMITS["default"];
  }

  /**
   * Check if messages fit within a model's context limit.
   * @param reserveTokens Tokens to reserve for the response
   */
  static fitsInContext(
    messages: Message[],
    model: string,
    reserveTokens: number = 500,
  ): boolean {
    const limit = this.getModelLimit(model) - reserveTokens;
    return this.estimateMessages(messages) <= limit;
  }
}

/**
 * Context limiter that truncates messages to fit within token budgets.
 */
export class ContextLimiter {
  private model: string;
  private reserveTokens: number;

  constructor(model: string, reserveTokens: number = 500) {
    this.model = model;
    this.reserveTokens = reserveTokens;
  }

  /**
   * Truncate message history to fit within model limits.
   * Always keeps the first message (system prompt) and as many recent messages as fit.
   */
  truncate(messages: Message[]): Message[] {
    if (messages.length === 0) return [];

    const maxTokens = TokenEstimator.getModelLimit(this.model) -
      this.reserveTokens;
    const systemMessage = messages[0];
    const systemTokens = TokenEstimator.estimateMessage(systemMessage);

    if (systemTokens >= maxTokens) {
      // System message alone exceeds limit - return just system (truncated prompt issue)
      console.warn("System message exceeds token limit");
      return [systemMessage];
    }

    let availableTokens = maxTokens - systemTokens;
    const recentMessages: Message[] = [];

    // Add messages from most recent, going backwards
    for (let i = messages.length - 1; i > 0; i--) {
      const msgTokens = TokenEstimator.estimateMessage(messages[i]);
      if (msgTokens <= availableTokens) {
        recentMessages.unshift(messages[i]);
        availableTokens -= msgTokens;
      } else {
        break; // Stop when a message doesn't fit
      }
    }

    return [systemMessage, ...recentMessages];
  }

  /**
   * Truncate to fit a specific number of tokens (for scene budgets).
   */
  truncateToTokens(messages: Message[], maxTokens: number): Message[] {
    if (messages.length === 0) return [];

    const result: Message[] = [];
    let usedTokens = 0;

    // Always include system message if present
    if (messages[0].role === "system") {
      const systemTokens = TokenEstimator.estimateMessage(messages[0]);
      result.push(messages[0]);
      usedTokens = systemTokens;
    }

    // Add recent messages that fit
    for (let i = messages.length - 1; i > 0; i--) {
      const msgTokens = TokenEstimator.estimateMessage(messages[i]);
      if (usedTokens + msgTokens <= maxTokens) {
        result.splice(1, 0, messages[i]); // Insert after system message
        usedTokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }
}

/**
 * Calculate how many "energy points" a set of messages would cost.
 * Used for the scene/day energy-as-tokens mechanic.
 */
export function calculateEnergyCost(
  messages: Message[],
  tokensPerEnergyPoint: number = 40,
): number {
  const tokens = TokenEstimator.estimateMessages(messages);
  return Math.ceil(tokens / tokensPerEnergyPoint);
}
```

### Testing Token Estimation

```typescript
// lib/game/llm/context/tokens_test.ts (Deno convention: *_test.ts)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateEnergyCost,
  ContextLimiter,
  TokenEstimator,
} from "./tokens.ts";
import { Message } from "../../types.ts";

Deno.test("TokenEstimator - estimate returns correct approximation", () => {
  // 100 characters ≈ 25 tokens
  const text = "a".repeat(100);
  assertEquals(TokenEstimator.estimate(text), 25);
});

Deno.test("TokenEstimator - estimateMessage includes overhead", () => {
  const message: Message = { role: "user", content: "Hello" };
  // "Hello" = 5 chars ≈ 2 tokens + 4 overhead = 6
  assertEquals(TokenEstimator.estimateMessage(message), 6);
});

Deno.test("TokenEstimator - fitsInContext returns true for small messages", () => {
  const messages: Message[] = [
    { role: "system", content: "You are a narrator." },
    { role: "user", content: "What do I see?" },
  ];

  assert(TokenEstimator.fitsInContext(messages, "gpt-oss:20b-cloud"));
});

Deno.test("ContextLimiter - truncate keeps system message", () => {
  const messages: Message[] = [
    { role: "system", content: "System prompt" },
    { role: "user", content: "Message 1" },
    { role: "assistant", content: "Response 1" },
    { role: "user", content: "Message 2" },
  ];

  const limiter = new ContextLimiter("gpt-oss:20b-cloud");
  const truncated = limiter.truncate(messages);

  assertEquals(truncated[0].role, "system");
  assertEquals(truncated[0].content, "System prompt");
});

Deno.test("ContextLimiter - truncate keeps recent messages", () => {
  const messages: Message[] = [
    { role: "system", content: "System prompt" },
    { role: "user", content: "Old message" },
    { role: "assistant", content: "Old response" },
    { role: "user", content: "Recent message" },
    { role: "assistant", content: "Recent response" },
  ];

  const limiter = new ContextLimiter("gpt-oss:20b-cloud");
  const truncated = limiter.truncate(messages);

  // Should include system + at least the most recent messages
  assert(truncated.length >= 2);
  assertEquals(truncated[truncated.length - 1].content, "Recent response");
});

Deno.test("calculateEnergyCost - returns correct cost", () => {
  const messages: Message[] = [
    { role: "user", content: "a".repeat(160) }, // 160 chars = 40 tokens + 4 overhead = 44 tokens
  ];

  // 44 tokens / 40 per energy = 2 energy (rounded up)
  assertEquals(calculateEnergyCost(messages, 40), 2);
});
```

---

## Phase 0.5: Test Utilities Consolidation

### Problem Statement

Test helper functions like `createTestWorld()` are duplicated across multiple
test files. This will get worse as new scene/day/memory types need test
builders.

Additionally, mock implementations of interfaces (like `MockNarrator`,
`MockSessionManager`) are defined inline in test files, making them hard to
reuse.

### Solution: Hybrid Approach

Use a **hybrid mock organization strategy**:

1. **Colocate interface mocks** with their interfaces (e.g.,
   `mock_session_manager.ts` in `session/`)
2. **Centralize test builders** in `_testing/` (e.g., `TestWorldBuilder`)

This approach:

- Makes mocks discoverable (they're exported from the same module as real
  implementations)
- Allows mocks to be used in production if needed (e.g., for demos)
- Keeps test data builders separate from production code

### New Module: `lib/game/_testing/builders.ts`

> **Note**: The `_testing` directory uses underscore prefix per Deno convention
> to indicate this is an internal module not meant to have a stable public API.
>
> This directory contains **only test data builders**, not mocks. Mocks live
> colocated with their interfaces.

```typescript
import { Entity, GameState, Message, SessionData, World } from "../types.ts";

/**
 * Fluent builder for creating test worlds.
 */
export class TestWorldBuilder {
  private world: World;

  constructor() {
    this.world = {
      world_name: "Test World",
      world_description: "A world for testing",
      starting_location: "start",
      entities: [],
    };
  }

  withName(name: string): this {
    this.world.world_name = name;
    return this;
  }

  withDescription(description: string): this {
    this.world.world_description = description;
    return this;
  }

  withStartingLocation(locationId: string): this {
    this.world.starting_location = locationId;
    return this;
  }

  withPlace(place: Partial<Entity> & { id: string; name: string }): this {
    this.world.entities.push({
      type: "place",
      description: `A place called ${place.name}`,
      connections: {},
      ...place,
    });
    return this;
  }

  withPerson(
    person: Partial<Entity> & { id: string; name: string; location: string },
  ): this {
    this.world.entities.push({
      type: "person",
      description: `A person named ${person.name}`,
      health: 100,
      energy: 100,
      inventory: [],
      ...person,
    });
    return this;
  }

  withItem(
    item: Partial<Entity> & { id: string; name: string; location: string },
  ): this {
    this.world.entities.push({
      type: "item",
      description: `An item called ${item.name}`,
      usable: true,
      consumable: false,
      ...item,
    });
    return this;
  }

  withConnection(
    fromId: string,
    toId: string,
    requirements?: { requires_item?: string; requires_health?: number },
  ): this {
    const place = this.world.entities.find((e) => e.id === fromId);
    if (place && place.type === "place") {
      place.connections = place.connections || {};
      place.connections[toId] = requirements || {};
    }
    return this;
  }

  build(): World {
    return JSON.parse(JSON.stringify(this.world));
  }

  /**
   * Create a minimal valid world for quick tests.
   */
  static minimal(): World {
    return new TestWorldBuilder()
      .withPlace({ id: "start", name: "Starting Area" })
      .withPerson({ id: "player", name: "Player", location: "start" })
      .withStartingLocation("start")
      .build();
  }

  /**
   * Create a standard test world with multiple locations and entities.
   */
  static standard(): World {
    return new TestWorldBuilder()
      .withName("Standard Test World")
      .withDescription("A standard world for testing")
      .withStartingLocation("town_square")
      .withPlace({
        id: "town_square",
        name: "Town Square",
        description: "The center of a small town",
      })
      .withPlace({
        id: "tavern",
        name: "The Rusty Nail Tavern",
        description: "A cozy tavern with a warm fire",
      })
      .withPlace({
        id: "forest",
        name: "Dark Forest",
        description: "A mysterious forest at the edge of town",
      })
      .withConnection("town_square", "tavern")
      .withConnection("town_square", "forest")
      .withConnection("tavern", "town_square")
      .withConnection("forest", "town_square")
      .withPerson({
        id: "player",
        name: "Hero",
        description: "A brave adventurer",
        location: "town_square",
        health: 100,
        energy: 80,
        inventory: [],
      })
      .withPerson({
        id: "bartender",
        name: "Old Tom",
        description: "The grizzled bartender",
        location: "tavern",
        health: 100,
        energy: 100,
      })
      .withItem({
        id: "health_potion",
        name: "Health Potion",
        description: "A red potion that restores health",
        location: "tavern",
        consumable: true,
        effects: { health: 25 },
      })
      .withItem({
        id: "torch",
        name: "Torch",
        description: "A wooden torch for lighting dark places",
        location: "town_square",
        usable: true,
        consumable: false,
      })
      .build();
  }
}

/**
 * Builder for creating test game states.
 */
export class TestGameStateBuilder {
  private gameState: GameState;

  constructor(world?: World) {
    this.gameState = {
      world: world ?? TestWorldBuilder.minimal(),
      playerId: "player",
      currentTurn: 1,
      messageHistory: [],
    };
  }

  withWorld(world: World): this {
    this.gameState.world = world;
    return this;
  }

  withPlayerId(playerId: string): this {
    this.gameState.playerId = playerId;
    return this;
  }

  withTurn(turn: number): this {
    this.gameState.currentTurn = turn;
    return this;
  }

  withSystemMessage(content: string): this {
    this.gameState.messageHistory.push({ role: "system", content });
    return this;
  }

  withUserMessage(content: string): this {
    this.gameState.messageHistory.push({ role: "user", content });
    return this;
  }

  withAssistantMessage(content: string): this {
    this.gameState.messageHistory.push({ role: "assistant", content });
    return this;
  }

  withMessages(messages: Message[]): this {
    this.gameState.messageHistory = [...messages];
    return this;
  }

  build(): GameState {
    return JSON.parse(JSON.stringify(this.gameState));
  }

  /**
   * Create a game state with standard setup (system message, opening).
   */
  static withStandardSetup(world?: World): GameState {
    const w = world ?? TestWorldBuilder.standard();
    return new TestGameStateBuilder(w)
      .withSystemMessage(
        `You are the narrator for an adventure in: ${w.world_description}`,
      )
      .withAssistantMessage("You find yourself in the town square...")
      .build();
  }
}

/**
 * Builder for creating test sessions.
 */
export class TestSessionBuilder {
  private session: SessionData;

  constructor() {
    this.session = {
      sessionId: crypto.randomUUID(),
      worldDescription: "A test world",
      generatedWorld: null,
      openingScene: null,
      currentGameState: null,
      currentTurn: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
  }

  withSessionId(id: string): this {
    this.session.sessionId = id;
    return this;
  }

  withWorldDescription(description: string): this {
    this.session.worldDescription = description;
    return this;
  }

  withWorld(world: World): this {
    this.session.generatedWorld = world;
    return this;
  }

  withOpeningScene(scene: string): this {
    this.session.openingScene = scene;
    return this;
  }

  withGameState(gameState: GameState): this {
    this.session.currentGameState = gameState;
    this.session.currentTurn = gameState.currentTurn;
    return this;
  }

  build(): SessionData {
    return JSON.parse(JSON.stringify(this.session));
  }

  /**
   * Create a session ready for gameplay (world generated, character selected).
   */
  static readyToPlay(): SessionData {
    const world = TestWorldBuilder.standard();
    const gameState = TestGameStateBuilder.withStandardSetup(world);

    return new TestSessionBuilder()
      .withWorld(world)
      .withOpeningScene("You arrive in the town square...")
      .withGameState(gameState)
      .build();
  }
}
```

### Colocated Mock: `lib/game/session/mock_session_manager.ts`

Mock implementations live alongside their interfaces, not in `_testing/`:

```typescript
// lib/game/session/mock_session_manager.ts
import { ISessionManager } from "./interface.ts";
import { GameState, SessionData, World } from "../types.ts";

/**
 * In-memory session manager for testing.
 */
export class MockSessionManager implements ISessionManager {
  private sessions: Map<string, SessionData> = new Map();

  async createSession(worldDescription: string): Promise<SessionData> {
    const session: SessionData = {
      sessionId: crypto.randomUUID(),
      worldDescription,
      generatedWorld: null,
      openingScene: null,
      currentGameState: null,
      currentTurn: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async saveSession(session: SessionData): Promise<void> {
    this.sessions.set(session.sessionId, {
      ...session,
      lastActivity: Date.now(),
    });
  }

  async updateWorld(sessionId: string, world: World): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.generatedWorld = world;
      session.lastActivity = Date.now();
    }
  }

  async updateOpeningScene(sessionId: string, scene: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.openingScene = scene;
      session.lastActivity = Date.now();
    }
  }

  async updateGameState(
    sessionId: string,
    gameState: GameState,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentGameState = gameState;
      session.currentTurn = gameState.currentTurn;
      session.lastActivity = Date.now();
    }
  }

  async cleanupOldSessions(): Promise<number> {
    return 0;
  }

  // Test helpers
  clear(): void {
    this.sessions.clear();
  }

  getAll(): SessionData[] {
    return Array.from(this.sessions.values());
  }
}
```

### Colocated Mock: `lib/game/llm/services/mock_world_generator.ts`

```typescript
// lib/game/llm/services/mock_world_generator.ts
import { IWorldGenerator } from "./interface.ts";
import { Message, World } from "../../types.ts";

/**
 * Mock world generator that returns predefined worlds.
 */
export class MockWorldGenerator implements IWorldGenerator {
  private world: World;
  private openingScene: string;
  private shouldFail: boolean = false;

  constructor(
    world: World,
    openingScene: string = "You begin your adventure...",
  ) {
    this.world = world;
    this.openingScene = openingScene;
  }

  setWorld(world: World): void {
    this.world = world;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async generateWorld(_description: string): Promise<World> {
    if (this.shouldFail) {
      throw new Error("Mock world generation failed");
    }
    return JSON.parse(JSON.stringify(this.world));
  }

  async generateOpeningScene(
    _world: World,
    _messageHistory: Message[],
  ): Promise<string> {
    if (this.shouldFail) {
      throw new Error("Mock opening scene generation failed");
    }
    return this.openingScene;
  }
}
```

### Colocated Mock: `lib/game/llm/services/mock_narrator.ts`

```typescript
// lib/game/llm/services/mock_narrator.ts
import { INarrator } from "./interface.ts";
import { Action, Message, World } from "../../types.ts";

/**
 * Mock narrator that returns predefined narrations.
 */
export class MockNarrator implements INarrator {
  private narrations: string[];
  private index: number = 0;
  private defaultNarration: string;

  constructor(
    narrations: string[] = [],
    defaultNarration: string = "You do the thing.",
  ) {
    this.narrations = narrations;
    this.defaultNarration = defaultNarration;
  }

  addNarration(narration: string): void {
    this.narrations.push(narration);
  }

  reset(): void {
    this.index = 0;
  }

  async narrateAction(
    _world: World,
    _action: Action,
    _changes: string[],
    _playerId: string,
    _messageHistory: Message[],
  ): Promise<string> {
    if (this.index < this.narrations.length) {
      return this.narrations[this.index++];
    }
    return this.defaultNarration;
  }
}
```

### Colocated Mock: `lib/game/llm/services/mock_action_selector.ts`

```typescript
// lib/game/llm/services/mock_action_selector.ts
import { IActionSelector } from "./interface.ts";
import { Action, Message, World } from "../../types.ts";

/**
 * Mock action selector that returns predefined action sets.
 */
export class MockActionSelector implements IActionSelector {
  private selectedActions: Action[] | null = null;

  setSelectedActions(actions: Action[]): void {
    this.selectedActions = actions;
  }

  async selectInterestingActions(
    _world: World,
    _playerId: string,
    _messageHistory: Message[],
    availableActions: Action[],
    maxActions: number = 9,
  ): Promise<Action[]> {
    if (this.selectedActions) {
      return this.selectedActions.slice(0, maxActions);
    }
    return availableActions.slice(0, maxActions);
  }
}
```

### Colocated Mock: `lib/game/llm/services/mock_discovery_generator.ts`

```typescript
// lib/game/llm/services/mock_discovery_generator.ts
import { IDiscoveryGenerator } from "./interface.ts";
import { Entity, Message, World } from "../../types.ts";

/**
 * Mock discovery generator that returns predefined discoveries.
 */
export class MockDiscoveryGenerator implements IDiscoveryGenerator {
  private discoveries: (Entity | null)[];
  private index: number = 0;

  constructor(discoveries: (Entity | null)[] = []) {
    this.discoveries = discoveries;
  }

  addDiscovery(discovery: Entity | null): void {
    this.discoveries.push(discovery);
  }

  reset(): void {
    this.index = 0;
  }

  async generateDiscovery(
    _world: World,
    _playerId: string,
    _messageHistory: Message[],
  ): Promise<Entity | null> {
    if (this.index < this.discoveries.length) {
      const discovery = this.discoveries[this.index++];
      return discovery ? JSON.parse(JSON.stringify(discovery)) : null;
    }
    return null;
  }
}
```

### New Module: `lib/game/_testing/mod.ts`

```typescript
// lib/game/_testing/mod.ts
// Internal test utilities module.
// Underscore prefix indicates this is not a stable public API.
// Deno convention: use mod.ts instead of index.ts
//
// NOTE: This module exports ONLY test data builders.
// Mock implementations are colocated with their interfaces:
//   - MockSessionManager → lib/game/session/mock_session_manager.ts
//   - MockNarrator → lib/game/llm/services/mock_narrator.ts
//   - etc.

export * from "./builders.ts";
```

### Migrate Existing Tests

Update existing test files to use the shared utilities:

```typescript
// Example: engine.test.ts - BEFORE
function createTestWorld(): World {
  return {
    world_name: "Test World",
    // ... 50 lines of world definition
  };
}

// Example: engine_test.ts - AFTER (Deno convention: *_test.ts)
import { TestWorldBuilder } from "./_testing/mod.ts";

// Use builder
const world = TestWorldBuilder.standard();

// Or customize
const customWorld = new TestWorldBuilder()
  .withPlace({ id: "dungeon", name: "Dark Dungeon" })
  .withPerson({ id: "hero", name: "Hero", location: "dungeon", health: 50 })
  .build();
```

---

## Phase 0.6: Session Middleware (Bonus)

### Problem Statement

Cookie parsing is duplicated in 3 route handlers:

```typescript
// Repeated in action.ts, status.ts, select-character.ts
const cookies = ctx.req.headers.get("cookie") || "";
const sessionMatch = cookies.match(/game-session=([^;]+)/);
const sessionId = sessionMatch?.[1];
```

### Solution

Create a session utility module for consistent cookie handling.

### New Module: `lib/game/session/utils.ts`

```typescript
import { FreshContext } from "$fresh/server.ts";

const SESSION_COOKIE_NAME = "game-session";

/**
 * Extract session ID from request cookies.
 */
export function extractSessionId(req: Request): string | null {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1] ?? null;
}

/**
 * Validate that a string is a valid UUID format.
 */
export function isValidSessionId(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Create a Set-Cookie header value for a session.
 */
export function createSessionCookie(
  sessionId: string,
  maxAgeSeconds: number,
): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

/**
 * Create a cookie that clears the session (for logout).
 */
export function createClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Helper to get session ID from Fresh context with validation.
 * Returns null if no valid session ID found.
 */
export function getSessionIdFromContext(ctx: FreshContext): string | null {
  const sessionId = extractSessionId(ctx.req);

  if (!sessionId) {
    return null;
  }

  if (!isValidSessionId(sessionId)) {
    console.warn(`Invalid session ID format: ${sessionId}`);
    return null;
  }

  return sessionId;
}

/**
 * Create a 401 Unauthorized response for missing/invalid sessions.
 */
export function unauthorizedResponse(
  message: string = "Unauthorized",
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a 400 Bad Request response.
 */
export function badRequestResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
```

### Updated Route Handlers

```typescript
// routes/api/game/action.ts - REFACTORED

import { Handlers } from "$fresh/server.ts";
import { GameService } from "../../../lib/game/game-service.ts";
import { KvSessionManager } from "../../../lib/game/session/kv-session-manager.ts";
import {
  badRequestResponse,
  getSessionIdFromContext,
  unauthorizedResponse,
} from "../../../lib/game/session/utils.ts";

export const handler: Handlers = {
  async POST(req, ctx) {
    // Use utility function
    const sessionId = getSessionIdFromContext(ctx);
    if (!sessionId) {
      return unauthorizedResponse("No valid session");
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Invalid JSON body");
    }

    const { action } = body;
    if (!action) {
      return badRequestResponse("Missing action");
    }

    const kv = await Deno.openKv();
    const sessionManager = new KvSessionManager(kv);
    const gameService = new GameService(sessionManager);

    try {
      const result = await gameService.performAction(sessionId, action);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Action failed:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
```

---

## Execution Order

Execute these phases in order:

```
Phase 0.1: State Immutability and Transactions
├── Create lib/game/state/transaction.ts
├── Create lib/game/state/mod.ts              # Deno: mod.ts not index.ts
├── Update lib/game/types.ts with new interfaces
├── Refactor lib/game/engine.ts to use transactions
├── Update lib/game/game_service.ts to handle transactional results
├── Create lib/game/state/transaction_test.ts  # Deno: *_test.ts not *.test.ts
└── Update existing engine_test.ts

Phase 0.2: Session TTL Extension
├── Update lib/game/session/kv_session_manager.ts
├── Update lib/game/types.ts (add createdAt to SessionData)
├── Update routes/api/game/init.ts (cookie max-age)
└── Test session extension behavior

Phase 0.3: Context Builder Abstraction
├── Create lib/game/llm/context/builder.ts
├── Create lib/game/llm/context/mod.ts        # Deno: mod.ts not index.ts
├── Refactor lib/game/llm/services/narrator.ts
├── Refactor lib/game/llm/services/action_selector.ts
├── Refactor lib/game/llm/services/discovery_generator.ts
└── Create lib/game/llm/context/builder_test.ts

Phase 0.4: Token Estimation
├── Create lib/game/llm/context/tokens.ts
├── Update lib/game/llm/context/mod.ts
├── Create lib/game/llm/context/tokens_test.ts
└── Optionally integrate with history truncation in game_service.ts

Phase 0.5: Test Utilities Consolidation (Hybrid Approach)
├── Create lib/game/_testing/builders.ts      # Centralized test data builders
├── Create lib/game/_testing/mod.ts
├── Create lib/game/session/mock_session_manager.ts  # Colocated with interface
├── Create lib/game/llm/services/mock_narrator.ts    # Colocated with interface
├── Create lib/game/llm/services/mock_action_selector.ts
├── Create lib/game/llm/services/mock_discovery_generator.ts
├── Create lib/game/llm/services/mock_world_generator.ts
├── Update lib/game/session/mod.ts to export mock
├── Update lib/game/llm/services/mod.ts to export mocks
├── Migrate lib/game/engine_test.ts to use builders
├── Migrate lib/game/game_service_test.ts to use builders/mocks
└── Migrate lib/game/validation_test.ts to use builders

Phase 0.6: Session Utilities (Optional)
├── Create lib/game/session/utils.ts
├── Refactor routes/api/game/action.ts
├── Refactor routes/api/game/status.ts
├── Refactor routes/api/game/select-character.ts
└── Refactor routes/api/game/init.ts
```

---

## Success Criteria

After completing Phase 0, the codebase should:

1. **State Management**
   - [ ] All entity mutations go through TransactionManager
   - [ ] Rollback is possible on any failure
   - [ ] State snapshots can be created at any point
   - [ ] Tests verify transaction commit/rollback behavior

2. **Session Lifecycle**
   - [ ] Sessions extend TTL on every access
   - [ ] Sessions persist for 7 days of activity
   - [ ] Cookie max-age matches server TTL
   - [ ] Session creation time is tracked

3. **Context Building**
   - [ ] Single ContextBuilder module used by all LLM services
   - [ ] No duplicated entity extraction code
   - [ ] Context building is testable in isolation

4. **Token Management**
   - [ ] TokenEstimator can estimate any string/message
   - [ ] ContextLimiter can truncate to model limits
   - [ ] Energy cost calculation is available for scene/day system

5. **Testing**
   - [ ] Shared test builders for World, GameState, Session
   - [ ] Shared mock implementations in single location
   - [ ] Existing tests migrated to use shared utilities
   - [ ] All new code has test coverage

6. **Code Quality**
   - [ ] No duplicated cookie parsing
   - [ ] Consistent error responses
   - [ ] Clear separation of concerns

---

## Estimated Effort

| Phase                  | Estimated Time  | Complexity |
| ---------------------- | --------------- | ---------- |
| 0.1 State Transactions | 4-6 hours       | High       |
| 0.2 Session TTL        | 1-2 hours       | Low        |
| 0.3 Context Builder    | 2-3 hours       | Medium     |
| 0.4 Token Estimation   | 2-3 hours       | Medium     |
| 0.5 Test Utilities     | 3-4 hours       | Medium     |
| 0.6 Session Middleware | 1-2 hours       | Low        |
| **Total**              | **13-20 hours** |            |

---

## Dependencies

- Deno runtime
- Fresh framework
- Existing Ollama integration (unchanged)
- Deno KV (unchanged, just different TTL)

---

## Risks and Mitigations

| Risk                                         | Mitigation                                              |
| -------------------------------------------- | ------------------------------------------------------- |
| Transaction refactor breaks existing tests   | Run tests after each file change, not at end            |
| Token estimation is inaccurate               | Use conservative estimates, tune later                  |
| Session TTL change affects existing sessions | Existing sessions will just get extended on next access |
| Context builder doesn't cover all cases      | Design for extensibility, add methods as needed         |

---

## Next Steps After Phase 0

Once Phase 0 is complete, proceed to Phase 1 of the scene/day architecture:

1. Scene data structure implementation
2. Scene lifecycle management
3. Scene summarization
4. Integration with transaction system for scene-boundary snapshots

The foundation work in Phase 0 makes Phase 1 significantly simpler because:

- Snapshots are trivial (just call createSnapshot at scene boundaries)
- Rollback is available (if scene compression fails)
- Context building is centralized (easy to add scene context)
- Token counting exists (energy-as-tokens is implementable)
- Testing is streamlined (builders for Scene, Day, Memory)
