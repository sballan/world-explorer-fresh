// Game type definitions for World Explorer

// Entity and World Schemas
export interface Entity {
  id: string; // unique identifier (lowercase_with_underscores)
  name: string; // display name
  type: "person" | "place" | "item";
  description: string; // flavor text for narration

  // REQUIRED for type: "person"
  location?: string; // id of place entity where this person is
  health?: number; // 0-100, person dies at 0
  energy?: number; // 0-100, needed for actions
  inventory?: string[]; // array of item entity ids

  // REQUIRED for type: "place"
  connections?: { // defines the location graph
    [placeId: string]: {
      requires_item?: string; // optional: item id needed to travel here
      requires_health?: number; // optional: minimum health to travel here
    };
  };

  // REQUIRED for type: "item"
  // location already defined above - id of place OR person entity
  usable?: boolean; // can this item be used?
  consumable?: boolean; // does it disappear after one use?
  effects?: { // what happens when used?
    health?: number; // health modifier (+ or -)
    energy?: number; // energy modifier (+ or -)
  };
}

export interface World {
  world_name: string;
  world_description: string;
  starting_location: string; // place id where game begins
  entities: Entity[];
}

// Action Types
export type ActionType =
  | "MOVE"
  | "TALK"
  | "TAKE_ITEM"
  | "DROP_ITEM"
  | "USE_ITEM"
  | "EXAMINE"
  | "REST"
  | "WAIT"
  | "EXPLORE";

export interface Action {
  type: ActionType;
  target?: string; // entity id
  description: string; // human-readable description
  energyCost: number;
}

export interface GameState {
  world: World;
  playerId: string;
  currentTurn: number;
  messageHistory: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

// Session-related interfaces for web
export interface SessionData {
  sessionId: string;
  worldDescription: string;
  generatedWorld: World | null;
  openingScene: string | null;
  currentGameState: GameState | null;
  currentTurn: number;
  lastActivity: number; // timestamp for session cleanup
}

// API Response types
export interface GameInitResponse {
  sessionId: string;
  world: World;
  openingScene: string;
  availableCharacters: Entity[];
}

export interface GameActionResponse {
  success: boolean;
  narration: string;
  gameState: {
    currentLocation: string;
    health: number;
    energy: number;
    inventory: string[];
  };
  availableActions: Action[];
  discovery?: Entity; // for EXPLORE actions
  gameOver?: boolean;
  gameOverReason?: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

// Message type for LLM interactions
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// State Transaction Types (Phase 0.1)

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

/**
 * Result of executing an action through the ActionEngine.
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;

  /** The world state after the action (or unchanged if failed) */
  world: World;

  /** Human-readable descriptions of changes for narration */
  changes: string[];

  /** Error message if action failed */
  error?: string;
}
