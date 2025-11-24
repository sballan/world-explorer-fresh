import type { Action, Entity, World } from "./types.ts";

// Action Generation and Execution Engine
export class ActionEngine {
  private world: World;
  private entityMap: Map<string, Entity>;

  constructor(world: World) {
    this.world = world;
    this.entityMap = new Map(world.entities.map((e) => [e.id, e]));
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

  executeAction(
    playerId: string,
    action: Action,
  ): { success: boolean; changes: string[]; newState: World } {
    const changes: string[] = [];
    const player = this.entityMap.get(playerId)!;

    // Apply energy cost
    if (action.energyCost > 0) {
      player.energy = Math.max(0, player.energy! - action.energyCost);
      changes.push(
        `Energy decreased by ${action.energyCost} (now ${player.energy})`,
      );
    }

    switch (action.type) {
      case "MOVE":
        player.location = action.target!;
        changes.push(
          `Moved to ${this.entityMap.get(action.target!)?.name}`,
        );
        break;

      case "TALK":
        changes.push(
          `Had a conversation with ${this.entityMap.get(action.target!)?.name}`,
        );
        break;

      case "TAKE_ITEM": {
        const itemToTake = this.entityMap.get(action.target!)!;
        itemToTake.location = playerId;
        player.inventory!.push(action.target!);
        changes.push(`Picked up ${itemToTake.name}`);
        break;
      }

      case "DROP_ITEM": {
        const itemToDrop = this.entityMap.get(action.target!)!;
        itemToDrop.location = player.location!;
        player.inventory = player.inventory!.filter((id) =>
          id !== action.target
        );
        changes.push(`Dropped ${itemToDrop.name}`);
        break;
      }

      case "USE_ITEM": {
        const itemToUse = this.entityMap.get(action.target!)!;
        if (itemToUse.effects) {
          if (itemToUse.effects.health) {
            player.health = Math.max(
              0,
              Math.min(100, player.health! + itemToUse.effects.health),
            );
            changes.push(
              `Health ${
                itemToUse.effects.health > 0 ? "increased" : "decreased"
              } by ${
                Math.abs(itemToUse.effects.health)
              } (now ${player.health})`,
            );
          }
          if (itemToUse.effects.energy) {
            player.energy = Math.max(
              0,
              Math.min(100, player.energy! + itemToUse.effects.energy),
            );
            changes.push(
              `Energy ${
                itemToUse.effects.energy > 0 ? "increased" : "decreased"
              } by ${
                Math.abs(itemToUse.effects.energy)
              } (now ${player.energy})`,
            );
          }
        }
        if (itemToUse.consumable) {
          player.inventory = player.inventory!.filter((id) =>
            id !== action.target
          );
          const index = this.world.entities.findIndex((e) =>
            e.id === action.target
          );
          if (index !== -1) {
            this.world.entities.splice(index, 1);
            this.entityMap.delete(action.target!);
          }
          changes.push(`${itemToUse.name} was consumed`);
        }
        break;
      }

      case "EXAMINE":
        changes.push(
          `Examined ${this.entityMap.get(action.target!)?.name}`,
        );
        break;

      case "REST":
        player.energy = Math.min(100, player.energy! + 70);
        changes.push(
          `Rested and recovered 70 energy (now ${player.energy})`,
        );
        break;

      case "WAIT":
        changes.push("Time passes...");
        break;

      case "EXPLORE":
        changes.push(
          "You explore your surroundings, searching for something new...",
        );
        // The actual discovery will be handled in the main game loop
        break;
    }

    return {
      success: true,
      changes,
      newState: this.world,
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
