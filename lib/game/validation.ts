import type { Entity, World } from "./types.ts";

// Validation function for world structure
export function validateWorld(
  world: World,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required fields
  if (!world || typeof world !== "object") {
    return { valid: false, errors: ["Invalid world object"] };
  }

  if (!world.entities || !Array.isArray(world.entities)) {
    return { valid: false, errors: ["World missing entities array"] };
  }

  if (!world.world_name) {
    errors.push("World missing world_name");
  }

  if (!world.world_description) {
    errors.push("World missing world_description");
  }

  if (!world.starting_location) {
    errors.push("World missing starting_location");
  }

  const entityMap = new Map<string, Entity>();
  const placeIds = new Set<string>();
  const personIds = new Set<string>();
  const itemIds = new Set<string>();

  // Build entity maps
  for (const entity of world.entities) {
    if (entityMap.has(entity.id)) {
      errors.push(`Duplicate entity id: ${entity.id}`);
    }
    entityMap.set(entity.id, entity);

    switch (entity.type) {
      case "place":
        placeIds.add(entity.id);
        break;
      case "person":
        personIds.add(entity.id);
        break;
      case "item":
        itemIds.add(entity.id);
        break;
    }
  }

  // Check starting location exists and is a place
  if (!placeIds.has(world.starting_location)) {
    errors.push(
      `Starting location '${world.starting_location}' does not exist or is not a place`,
    );
  }

  // Validate entities
  for (const entity of world.entities) {
    switch (entity.type) {
      case "person":
        if (entity.location === undefined || !placeIds.has(entity.location)) {
          errors.push(`Person '${entity.id}' has invalid location`);
        }
        if (
          entity.health === undefined || entity.health < 0 ||
          entity.health > 100
        ) {
          errors.push(`Person '${entity.id}' has invalid health`);
        }
        if (
          entity.energy === undefined || entity.energy < 0 ||
          entity.energy > 100
        ) {
          errors.push(`Person '${entity.id}' has invalid energy`);
        }
        if (!entity.inventory) {
          errors.push(`Person '${entity.id}' missing inventory array`);
        }
        break;

      case "place":
        if (!entity.connections) {
          errors.push(`Place '${entity.id}' missing connections`);
        } else {
          for (
            const [targetId, connection] of Object.entries(entity.connections)
          ) {
            if (!placeIds.has(targetId)) {
              errors.push(
                `Place '${entity.id}' has connection to invalid place '${targetId}'`,
              );
            }
            if (
              connection.requires_item &&
              !itemIds.has(connection.requires_item)
            ) {
              errors.push(
                `Place '${entity.id}' requires invalid item '${connection.requires_item}'`,
              );
            }
          }
        }
        break;

      case "item":
        if (!entity.location) {
          errors.push(`Item '${entity.id}' has no location`);
        } else if (
          !placeIds.has(entity.location) && !personIds.has(entity.location)
        ) {
          errors.push(
            `Item '${entity.id}' has invalid location '${entity.location}'`,
          );
        }
        break;
    }
  }

  // Check for at least one person at starting location
  const peopleAtStart = world.entities.filter(
    (e) => e.type === "person" && e.location === world.starting_location,
  );
  if (peopleAtStart.length === 0) {
    errors.push("No people at starting location");
  }

  // Check all places are reachable (simple connectivity check)
  if (placeIds.size > 0) {
    const visited = new Set<string>();
    const queue = [world.starting_location];
    visited.add(world.starting_location);

    while (queue.length > 0) {
      const currentPlace = queue.shift()!;
      const place = entityMap.get(currentPlace) as Entity;

      if (place?.connections) {
        for (const connectedId of Object.keys(place.connections)) {
          if (!visited.has(connectedId)) {
            visited.add(connectedId);
            queue.push(connectedId);
          }
        }
      }
    }

    for (const placeId of placeIds) {
      if (!visited.has(placeId)) {
        errors.push(
          `Place '${placeId}' is not reachable from starting location`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
