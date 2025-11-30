import type { Action, ActionResult, Entity, World } from "./types.ts";
import {
  cloneWorld,
  createEnergyChange,
  createHealthChange,
  createInventoryChange,
  createLocationChange,
  TransactionManager,
} from "./state/mod.ts";

// Action Generation and Execution Engine
export class ActionEngine {
  private world: World;
  private entityMap: Map<string, Entity>;
  private transactionManager: TransactionManager;

  constructor(world: World) {
    // Store a CLONE, not the original - ensures immutability
    this.world = cloneWorld(world);
    this.entityMap = new Map(this.world.entities.map((e) => [e.id, e]));
    this.transactionManager = new TransactionManager();
  }

  generateValidActions(playerId: string): Action[] {
    const actions: Action[] = [];
    const player = this.entityMap.get(playerId);

    if (!player || player.type !== "person") {
      return actions;
    }

    const playerLocation = this.entityMap.get(player.location!);
    if (!playerLocation || playerLocation.type !== "place") {
      return actions;
    }

    // REST action - always available
    actions.push({
      type: "REST",
      description: "Rest to recover energy",
      energyCost: 0,
    });

    // WAIT action - always available
    actions.push({
      type: "WAIT",
      description: "Wait and observe",
      energyCost: 0,
    });

    // EXPLORE action - always available (but costs energy)
    if (player.energy! >= 5) {
      actions.push({
        type: "EXPLORE",
        description: "Explore your surroundings to discover something new",
        energyCost: 4,
      });
    }

    // MOVE actions
    if (playerLocation.connections && player.energy! > 10) {
      for (
        const [targetId, connection] of Object.entries(
          playerLocation.connections,
        )
      ) {
        const targetPlace = this.entityMap.get(targetId);
        if (targetPlace) {
          // Check requirements
          let canMove = true;
          let requirements = "";

          if (
            connection.requires_item &&
            !player.inventory?.includes(connection.requires_item)
          ) {
            const requiredItem = this.entityMap.get(connection.requires_item);
            requirements = ` (requires ${
              requiredItem?.name || connection.requires_item
            })`;
            canMove = false;
          }

          if (
            connection.requires_health &&
            player.health! < connection.requires_health
          ) {
            requirements = ` (requires ${connection.requires_health} health)`;
            canMove = false;
          }

          if (canMove) {
            actions.push({
              type: "MOVE",
              target: targetId,
              description: `Travel to ${targetPlace.name}${requirements}`,
              energyCost: 5,
            });
          }
        }
      }
    }

    // TALK actions
    if (player.energy! >= 5) {
      const peopleHere = this.world.entities.filter(
        (e) =>
          e.type === "person" && e.location === player.location &&
          e.id !== playerId,
      );
      for (const person of peopleHere) {
        actions.push({
          type: "TALK",
          target: person.id,
          description: `Talk to ${person.name}`,
          energyCost: 3,
        });
      }
    }

    // TAKE_ITEM actions
    const itemsHere = this.world.entities.filter(
      (e) => e.type === "item" && e.location === player.location,
    );
    for (const item of itemsHere) {
      actions.push({
        type: "TAKE_ITEM",
        target: item.id,
        description: `Pick up ${item.name}`,
        energyCost: 0,
      });
    }

    // DROP_ITEM actions
    if (player.inventory && player.inventory.length > 0) {
      for (const itemId of player.inventory) {
        const item = this.entityMap.get(itemId);
        if (item) {
          actions.push({
            type: "DROP_ITEM",
            target: itemId,
            description: `Drop ${item.name}`,
            energyCost: 0,
          });
        }
      }
    }

    // USE_ITEM actions
    if (player.inventory && player.inventory.length > 0) {
      for (const itemId of player.inventory) {
        const item = this.entityMap.get(itemId);
        if (item && item.usable) {
          actions.push({
            type: "USE_ITEM",
            target: itemId,
            description: `Use ${item.name}`,
            energyCost: 0,
          });
        }
      }
    }

    // EXAMINE actions
    if (player.energy! >= 2) {
      // Can examine people here
      const peopleHere = this.world.entities.filter(
        (e) =>
          e.type === "person" && e.location === player.location &&
          e.id !== playerId,
      );
      for (const person of peopleHere) {
        actions.push({
          type: "EXAMINE",
          target: person.id,
          description: `Examine ${person.name}`,
          energyCost: 1,
        });
      }

      // Can examine items here or in inventory
      const allItems = [
        ...itemsHere,
        ...player.inventory!.map((id) => this.entityMap.get(id)!).filter(
          Boolean,
        ),
      ];
      for (const item of allItems) {
        if (item && item.type === "item") {
          actions.push({
            type: "EXAMINE",
            target: item.id,
            description: `Examine ${item.name}`,
            energyCost: 1,
          });
        }
      }

      // Can examine the current location
      actions.push({
        type: "EXAMINE",
        target: player.location!,
        description: `Examine ${playerLocation.name}`,
        energyCost: 1,
      });
    }

    return actions;
  }

  /**
   * Execute an action using transaction pattern.
   * Returns a new world state (original is never modified).
   */
  executeAction(playerId: string, action: Action, turn: number): ActionResult {
    const player = this.entityMap.get(playerId);

    // Validate player exists
    if (!player || player.type !== "person") {
      return {
        success: false,
        world: this.world,
        changes: [],
        error: "Invalid player",
      };
    }

    // Start transaction
    this.transactionManager.startTransaction(this.world, turn);

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
        case "TALK":
          this.recordTalkChanges(player, action, turn);
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
        case "EXAMINE":
          this.recordExamineChanges(action, turn);
          break;
        case "REST":
          this.recordRestChanges(player, turn);
          break;
        case "WAIT":
          // No state changes for WAIT
          break;
        case "EXPLORE":
          // No state changes for EXPLORE (discovery handled externally)
          break;
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

  /**
   * Validate that an action can be performed.
   */
  private validateAction(action: Action, player: Entity): string | null {
    // Check energy
    if (player.energy! < action.energyCost) {
      return `Not enough energy. Need ${action.energyCost}, have ${player.energy}.`;
    }

    // Action-specific validation
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
          return "Cannot take item: not available.";
        }
        break;
      }
      case "DROP_ITEM": {
        if (!player.inventory?.includes(action.target!)) {
          return "Cannot drop item: not in inventory.";
        }
        break;
      }
      case "USE_ITEM": {
        if (!player.inventory?.includes(action.target!)) {
          return "Cannot use item: not in inventory.";
        }
        break;
      }
      case "TALK": {
        const target = this.entityMap.get(action.target!);
        if (!target || target.type !== "person") {
          return "Cannot talk to: invalid target.";
        }
        if (target.location !== player.location) {
          return "Cannot talk to: not in same location.";
        }
        break;
      }
      case "EXAMINE": {
        const target = this.entityMap.get(action.target!);
        if (!target) {
          return "Cannot examine: invalid target.";
        }
        break;
      }
    }

    return null;
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

  private recordTalkChanges(
    _player: Entity,
    action: Action,
    turn: number,
  ): void {
    const target = this.entityMap.get(action.target!);
    // Record as a no-op change for tracking conversation
    this.transactionManager.recordChange({
      entityId: action.target!,
      field: "__conversation__",
      oldValue: null,
      newValue: turn,
      turn,
      description: `Had a conversation with ${target?.name || action.target}.`,
    });
  }

  private recordTakeItemChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    const item = this.entityMap.get(action.target!);
    if (!item) throw new Error(`Item not found: "${action.target}"`);

    // Update item location to indicate it's in inventory
    this.transactionManager.recordChange({
      entityId: item.id,
      field: "location",
      oldValue: item.location,
      newValue: player.id,
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
        item.name,
      ),
    );
  }

  private recordDropItemChanges(
    player: Entity,
    action: Action,
    turn: number,
  ): void {
    const item = this.entityMap.get(action.target!);
    if (!item) throw new Error(`Item not found: "${action.target}"`);

    // Update item location to player's current location
    this.transactionManager.recordChange({
      entityId: item.id,
      field: "location",
      oldValue: player.id,
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
        item.name,
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
      throw new Error(`Invalid item: "${action.target}"`);
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
          item.name,
        ),
      );

      // Mark entity as removed
      this.transactionManager.recordChange({
        entityId: item.id,
        field: "__remove_entity__",
        oldValue: item,
        newValue: null,
        turn,
        description: `${item.name} was consumed.`,
      });
    }
  }

  private recordExamineChanges(action: Action, turn: number): void {
    const target = this.entityMap.get(action.target!);
    if (!target) throw new Error(`Target not found: "${action.target}"`);

    // Record as a no-op change for tracking examination
    this.transactionManager.recordChange({
      entityId: action.target!,
      field: "__examined__",
      oldValue: null,
      newValue: turn,
      turn,
      description: `Examined ${target.name}.`,
    });
  }

  private recordRestChanges(player: Entity, turn: number): void {
    const newEnergy = Math.min(100, player.energy! + 70);
    this.transactionManager.recordChange(
      createEnergyChange(player.id, player.energy!, newEnergy, turn, "resting"),
    );
  }

  // Legacy method signature for backwards compatibility
  executeActionLegacy(
    playerId: string,
    action: Action,
  ): { success: boolean; changes: string[]; newState: World } {
    const result = this.executeAction(playerId, action, 0);
    return {
      success: result.success,
      changes: result.changes,
      newState: result.world,
    };
  }

  // Helper method to get the current state of a player
  getPlayerState(playerId: string) {
    const player = this.entityMap.get(playerId);
    if (!player || player.type !== "person") {
      return null;
    }

    return {
      currentLocation: player.location!,
      health: player.health!,
      energy: player.energy!,
      inventory: player.inventory!,
    };
  }

  // Helper method to get entity by ID
  getEntity(entityId: string): Entity | undefined {
    return this.entityMap.get(entityId);
  }
}
