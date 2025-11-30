# Context-Aware World Explorer: Design Specification

> **Deno Style Guide Compliance**
>
> This document follows
> [Deno's official style guide](https://docs.deno.com/runtime/contributing/style_guide/):
>
> - **`mod.ts`** instead of `index.ts` for module entry points
> - **`snake_case`** for filenames (e.g., `scene_manager.ts`)
> - **`*_test.ts`** suffix for test files (e.g., `scene_test.ts`)
> - **Underscore prefix** for internal modules (e.g., `_internal.ts`)
> - **Top-level `function`** keyword instead of arrow functions
> - **JSDoc** on all exported symbols
> - **Max 2 required args** plus optional options object for exported functions

## Overview

This document describes the architecture for a long-running, LLM-powered text
adventure game that maps context window constraints directly to game mechanics.
The core insight is that **energy, scenes, and days are not just narrative
constructs — they are the player's experience of token budget management**.

The system must support games that run for hundreds or thousands of turns while
maintaining narrative coherence, character memory, and world consistency.

---

## Core Principles

### 1. Diegetic Constraints

Every technical limitation should feel like a game mechanic:

- Running out of context → character gets tired
- Memory truncation → sleeping and dreaming
- Retrieval from vector DB → character "remembering" something
- Forced scene transitions → natural narrative beats

The player should never feel like they're fighting the AI's limitations. They
should feel like they're playing a game with interesting resource management.

### 2. Hierarchical Memory

Memory exists at multiple levels, each with different granularity and retrieval
costs:

```
Level 0: Current Scene (full detail, in active context)
Level 1: Today's Scene Summaries (compressed, in active context)
Level 2: Day Summaries (highly compressed, queryable)
Level 3: Vector Database (everything, semantic search)
Level 4: Fact Store (structured assertions, rule-based lookup)
```

### 3. Energy as Token Budget

The player's "energy" is a direct function of how many tokens remain available
for the current day's scene summaries. This creates natural pressure toward rest
and scene closure.

### 4. Self-Healing Narrative

Inconsistencies will occur. The system includes an asynchronous consistency
watcher that detects contradictions and triggers narrative corrections ranging
from subtle adjustments to "it was a dream" retcons.

---

## Data Structures

### Scene

A scene is the fundamental unit of gameplay. It represents a continuous sequence
of interactions in a single context (conversation, exploration, puzzle-solving).

```typescript
interface Scene {
  id: string; // Unique identifier
  dayId: string; // Parent day
  sceneNumber: number; // Order within day

  // Scene classification
  type: SceneType; // "travel" | "dialogue" | "interaction" | "exploration" | "combat" | "rest"
  location: string; // Place entity ID
  participants: string[]; // Entity IDs involved (NPCs, items)

  // Content
  messages: Message[]; // Full conversation/action history
  stateChanges: StateChange[]; // What changed during this scene

  // Compression
  summary: string; // Generated when scene ends
  summaryTokenCount: number; // Cost against day's budget

  // Metadata
  startedAt: number; // Timestamp
  endedAt: number | null; // Null if scene is active
  endReason: SceneEndReason; // "natural" | "energy_exhausted" | "token_limit" | "player_choice"

  // Retrieval
  embedding: number[]; // Vector for semantic search
  keywords: string[]; // Explicit tags for retrieval
}

type SceneType =
  | "travel" // Moving between locations
  | "dialogue" // Conversation with NPC
  | "interaction" // Using items, examining things
  | "exploration" // Discovering new entities
  | "combat" // Fighting (if implemented)
  | "rest" // Recovering energy
  | "memory"; // Recalling past events (costs energy)

interface StateChange {
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  turn: number;
}

type SceneEndReason =
  | "natural" // Conversation ended, player left area
  | "energy_exhausted" // Player too tired to continue
  | "token_limit" // Scene approaching context limit
  | "player_choice" // Player explicitly ended scene
  | "forced_transition"; // System forced transition (e.g., attacked)
```

### Day

A day is a collection of scenes bounded by sleep. When the player sleeps, the
day ends and compression happens.

```typescript
interface Day {
  id: string; // Unique identifier
  dayNumber: number; // Sequential day count

  // Scenes
  scenes: Scene[]; // All scenes in this day
  activeSceneId: string | null; // Currently active scene

  // Energy management
  startingEnergy: number; // Energy at day start (usually 100)
  currentEnergy: number; // Remaining energy
  maxSceneSummaryTokens: number; // Total budget for scene summaries
  usedSceneSummaryTokens: number; // How much has been used

  // Compression
  sceneSummaries: string[]; // Summary of each completed scene
  daySummary: string | null; // Generated when day ends

  // Metadata
  startedAt: number;
  endedAt: number | null;

  // Retrieval
  embedding: number[]; // Vector for semantic search
  significantEvents: string[]; // Key things that happened (for quick lookup)
}
```

### Memory Retrieval

When the player (or system) needs to recall past events, a Memory object is
created.

```typescript
interface Memory {
  id: string;
  triggeredBy: MemoryTrigger; // What caused this recall
  query: string; // What we're looking for

  // Retrieved content
  relevantDays: DayReference[]; // Days that might be relevant
  relevantScenes: SceneReference[]; // Specific scenes retrieved

  // Output
  narrativeText: string; // "You remember..." text shown to player

  // Cost
  energyCost: number; // Energy spent on recall
  tokenCost: number; // Context used

  // Tracking
  sceneId: string; // Scene in which this memory occurred
  turn: number; // Turn number
}

type MemoryTrigger =
  | "player_recall" // Player explicitly tried to remember
  | "entity_encounter" // Seeing someone/something from the past
  | "location_return" // Returning to a previously visited place
  | "item_recognition" // Item triggers memory
  | "narrative_need"; // System determined context was needed

interface DayReference {
  dayId: string;
  dayNumber: number;
  summary: string;
  relevanceScore: number;
}

interface SceneReference {
  sceneId: string;
  dayId: string;
  summary: string;
  relevanceScore: number;
  fullContentLoaded: boolean; // Whether we loaded full messages
}
```

### Fact Store

Structured assertions about the world that can be checked for consistency.

```typescript
interface Fact {
  id: string;

  // The assertion
  subject: string; // Entity ID or "world"
  predicate: string; // What we're asserting (e.g., "alive", "has_item", "location")
  object: string | number | boolean; // The value

  // Provenance
  establishedIn: string; // Scene ID where this was established
  establishedAt: number; // Timestamp
  confidence: FactConfidence; // How sure are we

  // Lifecycle
  supersededBy: string | null; // If this fact was replaced, by what
  supersededAt: number | null;

  // For consistency checking
  contradictions: string[]; // Fact IDs that contradict this
}

type FactConfidence =
  | "certain" // Mechanically verified (player took item)
  | "observed" // Narrated as happening
  | "reported" // NPC said it (might be lying)
  | "inferred" // System deduced it
  | "uncertain"; // Low-energy observation, might be wrong
```

### Game State

The overall game state, persisted per session.

```typescript
interface GameState {
  sessionId: string;

  // World
  world: World; // All entities (grows over time)

  // Player
  playerId: string; // Player's character entity ID

  // Time
  currentDayId: string;
  currentSceneId: string | null;
  totalTurns: number;

  // Memory
  days: Day[]; // All days (summaries only for old days)
  facts: Fact[]; // Fact store

  // Consistency
  pendingCorrections: Correction[]; // Inconsistencies awaiting resolution
  dreamBudget: number; // How many "it was a dream" retcons remain

  // Meta
  createdAt: number;
  lastActivity: number;
}
```

---

## Energy System

### Energy as Token Budget

Energy is not an arbitrary number — it directly maps to context window capacity.

```typescript
interface EnergyConfig {
  maxEnergy: number; // e.g., 100
  maxSceneSummaryTokens: number; // e.g., 4000 tokens for day's summaries
  tokensPerEnergyPoint: number; // maxSceneSummaryTokens / maxEnergy = 40

  // Scene length limits
  maxSceneTokensAtFullEnergy: number; // e.g., 8000 (long scenes when fresh)
  minSceneTokensAtLowEnergy: number; // e.g., 1000 (short scenes when tired)

  // Action costs
  actionEnergyCosts: Record<ActionType, number>;
  memoryRecallCost: number; // Cost to search past memories
}

// Scene token budget calculation
function calculateMaxSceneTokens(
  currentEnergy: number,
  config: EnergyConfig,
): number {
  const energyRatio = currentEnergy / config.maxEnergy;
  const range = config.maxSceneTokensAtFullEnergy -
    config.minSceneTokensAtLowEnergy;
  return Math.floor(config.minSceneTokensAtLowEnergy + (range * energyRatio));
}

// Energy remaining after accounting for today's summaries
function calculateEffectiveEnergy(day: Day, config: EnergyConfig): number {
  const tokensRemaining = config.maxSceneSummaryTokens -
    day.usedSceneSummaryTokens;
  return Math.floor(tokensRemaining / config.tokensPerEnergyPoint);
}
```

### Energy Costs

| Action        | Energy Cost  | Notes                         |
| ------------- | ------------ | ----------------------------- |
| Move          | 5            | Travel between locations      |
| Talk          | 3            | Start/continue conversation   |
| Examine       | 1            | Look at something             |
| Take Item     | 0            | Quick action                  |
| Drop Item     | 0            | Quick action                  |
| Use Item      | 2            | Depends on item               |
| Explore       | 4            | Discover new things           |
| Rest          | -30          | Recover energy (caps at max)  |
| Sleep         | Full restore | Ends the day                  |
| Recall Memory | 3-10         | Depends on how deep we search |

### Energy and Scene Length Relationship

```
Energy Level    Max Scene Tokens    Player Experience
-----------     ----------------    -----------------
100% (Fresh)    8000 tokens         Long, expansive scenes. Extended dialogues.
75%             6250 tokens         Normal gameplay
50%             4500 tokens         Scenes starting to feel shorter
25%             2750 tokens         Rushed interactions, terse NPCs
10%             1400 tokens         Very brief scenes, must wrap up
5%              1000 tokens         Minimal scenes, "too tired to focus"
0%              Forced sleep        Day ends
```

### Energy Exhaustion Behavior

When energy hits critical levels:

1. **Warning at 15%**: "You're getting tired. You should find somewhere to rest
   soon."
2. **Pressure at 10%**: Scenes auto-truncate more aggressively. NPCs notice:
   "You look exhausted."
3. **Critical at 5%**: Only essential actions available. "You can barely keep
   your eyes open."
4. **Forced sleep at 0%**: "You collapse from exhaustion." Day ends wherever the
   player is.

---

## Scene Management

### Scene Lifecycle

```
1. SCENE START
   - Triggered by: location change, NPC interaction, item use, exploration
   - Calculate max tokens based on current energy
   - Initialize message history
   - Set scene type and participants

2. SCENE ACTIVE
   - Player takes actions, messages accumulate
   - Track token count continuously
   - Monitor for natural ending points
   - Deduct energy for actions

3. SCENE ENDING DETECTION
   Triggers:
   - Player explicitly ends (leaves area, ends conversation)
   - Token limit approaching (90% of max)
   - Energy exhausted
   - Natural narrative conclusion detected
   - Forced transition (external event)

4. SCENE COMPRESSION
   - Generate scene summary (LLM call)
   - Calculate summary token count
   - Add to day's scene summaries
   - Update day's usedSceneSummaryTokens
   - Generate embedding for vector storage
   - Extract and store facts

5. SCENE TRANSITION
   - If energy > 0: Start new scene based on context
   - If energy = 0: Force sleep, end day
```

### Scene Types and Transitions

```typescript
interface SceneTransition {
  from: SceneType;
  to: SceneType;
  trigger: string;
  narrativeText: string;
}

// Examples:
// dialogue → travel: "You say goodbye to the merchant and head outside."
// exploration → dialogue: "As you search the ruins, you encounter a stranger."
// interaction → combat: "The trap triggers, and guards rush in!"
// any → rest: "You find a quiet spot and close your eyes for a moment."
```

### Forced Scene Endings

When a scene must end due to token limits:

```typescript
interface ForcedEndingStrategy {
  type: SceneType;
  lowEnergyEndings: string[];    // Phrases for tired player
  tokenLimitEndings: string[];   // Phrases for scene too long
  transitionPrompt: string;      // How to generate natural ending
}

// Example for dialogue:
{
  type: "dialogue",
  lowEnergyEndings: [
    "Your thoughts begin to drift, and [NPC] notices your exhaustion.",
    "You stifle a yawn. [NPC] suggests continuing this another time.",
    "Your eyelids grow heavy. The conversation will have to wait."
  ],
  tokenLimitEndings: [
    "[NPC] glances at the window. 'I should let you go. We can talk more later.'",
    "A bell chimes in the distance. [NPC] looks up. 'Another time, perhaps.'",
    "The conversation reaches a natural pause."
  ],
  transitionPrompt: "Generate a brief, natural ending to this conversation that leaves room for continuation later."
}
```

---

## Day Management

### Day Lifecycle

```
1. DAY START
   - Reset energy to max (100)
   - Initialize scene summary budget
   - Clear active scene
   - If previous day exists, ensure day summary was generated

2. DAY ACTIVE
   - Player moves through scenes
   - Scene summaries accumulate
   - Energy depletes
   - Memories may be recalled (costing energy)

3. DAY ENDING DETECTION
   Triggers:
   - Player chooses to sleep
   - Energy hits 0 (forced sleep)
   - Scene summary budget exhausted

4. DAY COMPRESSION
   - Generate day summary from all scene summaries
   - Generate embedding for vector storage
   - Extract significant events for quick lookup
   - Store full scenes in long-term storage
   - Run consistency check on day's events

5. SLEEP SEQUENCE (optional enhancement)
   - Generate dream sequence surfacing significant memories
   - Potentially foreshadow or hint at connections
   - Strengthen important memories in vector DB
   - Reset for new day
```

### Day Summary Generation

```typescript
interface DaySummaryPrompt {
  dayNumber: number;
  sceneSummaries: string[];
  significantStateChanges: StateChange[];
  newEntitiesDiscovered: Entity[];
  factsEstablished: Fact[];
}

// Prompt template:
`Summarize Day ${dayNumber} of this adventure. The player experienced these scenes:

${sceneSummaries.map((s, i) => `Scene ${i + 1}: ${s}`).join("\n\n")}

Key events:
- New discoveries: ${
  newEntitiesDiscovered.map((e) => e.name).join(", ") || "None"
}
- Important facts learned: ${
  factsEstablished.map((f) => `${f.subject} ${f.predicate} ${f.object}`).join(
    "; ",
  ) || "None"
}

Write a 2-3 sentence summary capturing the essence of this day. Focus on what would be most memorable to the player character.`;
```

---

## Memory Retrieval System

### Retrieval Pipeline

```
1. TRIGGER
   - Player action: "recall [topic]"
   - System detection: entity from past encountered
   - Narrative need: context required for coherent response

2. QUERY FORMULATION
   - Extract query from trigger
   - Identify time scope (today, recent, all time)
   - Identify entity scope (specific NPC, location, item)

3. VECTOR SEARCH
   - Search scene embeddings for semantic similarity
   - Search day embeddings for broader matches
   - Rank by relevance score

4. CANDIDATE SELECTION
   - Filter by relevance threshold
   - Limit by energy budget (deeper search = more energy)
   - Select top N candidates

5. DETAIL RETRIEVAL (if needed)
   - For high-relevance matches, load full scene content
   - Use dedicated context window to answer specific question
   - Extract relevant details

6. NARRATIVE GENERATION
   - Generate "You remember..." text
   - Weave into current scene naturally
   - Record memory as part of current scene (costs energy)

7. STATE UPDATE
   - Deduct energy cost
   - Add memory to current scene's messages
   - Update any relevant facts
```

### Memory Search Depth

```typescript
interface MemorySearchConfig {
  quick: {
    energyCost: 3;
    maxDaysBack: 3;
    maxScenesRetrieved: 2;
    loadFullContent: false;
  };
  standard: {
    energyCost: 5;
    maxDaysBack: 10;
    maxScenesRetrieved: 5;
    loadFullContent: true; // For top match only
  };
  deep: {
    energyCost: 10;
    maxDaysBack: null; // All time
    maxScenesRetrieved: 10;
    loadFullContent: true; // For top 3 matches
  };
}
```

### Memory Narrativization

Memories should feel natural, not like database queries:

```typescript
interface MemoryNarrative {
  trigger: MemoryTrigger;
  templates: string[];
}

const memoryNarratives: MemoryNarrative[] = [
  {
    trigger: "entity_encounter",
    templates: [
      "Seeing {entity}, you're reminded of {memory}.",
      "You recognize {entity}. The last time you met, {memory}.",
      "{entity} looks familiar. Yes — {memory}.",
    ],
  },
  {
    trigger: "location_return",
    templates: [
      "Being back in {location} brings back memories. {memory}.",
      "You remember the last time you were here. {memory}.",
      "This place holds memories for you. {memory}.",
    ],
  },
  {
    trigger: "player_recall",
    templates: [
      "You try to remember... {memory}.",
      "Thinking back, you recall {memory}.",
      "The memory surfaces slowly. {memory}.",
    ],
  },
];
```

### Remembering Remembering

When a memory recall happens, it becomes part of the current scene and will be
included in that scene's summary. This means:

1. Future days can retrieve the memory-recall event itself
2. The player's act of remembering is part of their history
3. Chains of recall are possible ("You remember that yesterday you were thinking
   about...")

---

## Consistency System

### The Consistency Watcher

An asynchronous process that monitors for contradictions.

```typescript
interface ConsistencyWatcher {
  // Runs after each action, in background
  checkAction(
    action: Action,
    result: ActionResult,
    gameState: GameState,
  ): Promise<Inconsistency[]>;

  // Runs at end of each scene
  checkScene(scene: Scene, gameState: GameState): Promise<Inconsistency[]>;

  // Runs at end of each day
  checkDay(day: Day, gameState: GameState): Promise<Inconsistency[]>;
}

interface Inconsistency {
  id: string;
  severity: InconsistencySeverity;
  type: InconsistencyType;

  // What's wrong
  description: string;
  conflictingFacts: [Fact, Fact]; // The two facts that contradict

  // When detected
  detectedAt: number;
  detectedInScene: string;

  // Resolution
  status: "pending" | "resolved" | "ignored";
  resolution: Resolution | null;
}

type InconsistencySeverity = "minor" | "medium" | "major" | "critical";

type InconsistencyType =
  | "entity_state" // Entity property contradicts established fact
  | "entity_existence" // Entity exists that shouldn't / doesn't exist that should
  | "location" // Entity in wrong place
  | "timeline" // Events out of order
  | "knowledge" // Character knows something they shouldn't
  | "physical"; // Physically impossible situation
```

### Severity Levels and Responses

```typescript
interface SeverityResponse {
  severity: InconsistencySeverity;
  examples: string[];
  resolutionStrategies: ResolutionStrategy[];
  playerVisibility: "invisible" | "subtle" | "noticeable" | "dramatic";
}

const severityResponses: SeverityResponse[] = [
  {
    severity: "minor",
    examples: [
      "NPC eye color changed",
      "Item description slightly different",
      "Weather inconsistent",
    ],
    resolutionStrategies: ["silent_correction"],
    playerVisibility: "invisible",
  },
  {
    severity: "medium",
    examples: [
      "Player has item they never picked up",
      "NPC knows information player didn't share",
      "Location has feature that wasn't mentioned before",
    ],
    resolutionStrategies: ["narrative_excuse", "retcon_discovery"],
    playerVisibility: "subtle",
  },
  {
    severity: "major",
    examples: [
      "Dead NPC is alive",
      "Destroyed location still exists",
      "Player's actions contradicted",
    ],
    resolutionStrategies: [
      "unreliable_narrator",
      "mistaken_identity",
      "magical_intervention",
    ],
    playerVisibility: "noticeable",
  },
  {
    severity: "critical",
    examples: [
      "Fundamental world logic broken",
      "Multiple major contradictions compound",
      "Player's core identity/abilities contradicted",
    ],
    resolutionStrategies: [
      "dream_sequence",
      "alternate_timeline",
      "reality_shift",
    ],
    playerVisibility: "dramatic",
  },
];
```

### Resolution Strategies

```typescript
type ResolutionStrategy =
  // Invisible fixes
  | "silent_correction" // Just update the fact, no narrative
  // Subtle narrative fixes
  | "narrative_excuse" // "You must have picked it up without thinking"
  | "retcon_discovery" // "You notice it was there all along"
  | "character_confusion" // "Wait, was it always blue? You could have sworn..."
  // Noticeable narrative fixes
  | "unreliable_narrator" // "Perhaps your memory deceives you"
  | "mistaken_identity" // "On closer inspection, this is a different person"
  | "magical_intervention" // "Strange forces are at work here"
  | "time_shift" // "Something has changed since you were last here"
  // Dramatic fixes
  | "dream_sequence" // "You wake with a start. Was it all a dream?"
  | "alternate_timeline" // "Reality shifts around you"
  | "reality_shift"; // "The world itself seems to rewrite"

interface Resolution {
  strategy: ResolutionStrategy;
  narrativeText: string;
  factsModified: string[]; // Fact IDs that were changed
  appliedAt: number;
  appliedInScene: string;
}
```

### Dream Budget

To prevent overuse of dramatic fixes:

```typescript
interface DreamBudget {
  maxDreamsPerWeek: number; // e.g., 1
  currentWeekDreams: number;
  lastDreamDay: number;

  // Alternative escalation when dream budget exhausted
  alternativeStrategies: ResolutionStrategy[]; // ["reality_shift", "curse_effect"]
}
```

### Energy-Linked Reliability

When player energy is low, inconsistencies are more acceptable:

```typescript
function getReliabilityModifier(energy: number): number {
  if (energy > 50) return 1.0; // Full reliability expected
  if (energy > 25) return 0.8; // Minor inconsistencies acceptable
  if (energy > 10) return 0.5; // "You're tired, things are fuzzy"
  return 0.2; // "Exhaustion plays tricks on you"
}

// Low reliability means:
// - Inconsistencies during this period can be attributed to tiredness
// - Corrections can use "you were confused from exhaustion" excuse
// - Player is primed to expect unreliable perception
```

---

## LLM Integration

### Context Window Strategy

Different LLM calls have different context needs:

```typescript
interface LLMContextStrategy {
  narrator: {
    includes: [
      "system_prompt", // World setting, narrator voice
      "current_scene_messages", // Full current scene
      "today_scene_summaries", // What happened today
      "relevant_memories", // If any were retrieved
      "current_action", // What player is doing
    ];
    excludes: ["full_world_state", "all_entities", "old_days"];
    maxTokens: 8000;
  };

  actionSelector: {
    includes: [
      "available_actions",
      "current_location",
      "player_status",
      "recent_context", // Last few messages only
    ];
    excludes: ["full_history", "other_locations"];
    maxTokens: 4000;
  };

  discoveryGenerator: {
    includes: [
      "current_location",
      "entities_here",
      "world_theme",
      "recent_discoveries", // Avoid repetition
    ];
    excludes: ["full_history", "distant_locations"];
    maxTokens: 4000;
  };

  memorySummarizer: {
    includes: [
      "scene_to_summarize", // Full scene content
      "summary_requirements", // What to preserve
    ];
    excludes: ["other_scenes", "world_state"];
    maxTokens: 4000;
  };

  consistencyChecker: {
    includes: [
      "relevant_facts",
      "recent_events",
      "entity_states",
    ];
    excludes: ["narrative_details", "old_history"];
    maxTokens: 4000;
  };

  memoryRetriever: {
    // Dedicated context for answering questions about past
    includes: [
      "retrieved_scene_content", // Full scene being examined
      "specific_question", // What we need to know
    ];
    excludes: ["current_game_state"]; // Isolated context
    maxTokens: 4000;
  };
}
```

### Prompt Templates

Key prompts that need to be implemented:

1. **Scene Summarization Prompt**
   - Input: Full scene messages, scene type, participants
   - Output: 2-4 sentence summary preserving key facts
   - Constraint: Must fit in scene summary token budget

2. **Day Summarization Prompt**
   - Input: All scene summaries, key events, state changes
   - Output: 2-3 sentence day summary
   - Constraint: Must capture what's memorable

3. **Memory Retrieval Answer Prompt**
   - Input: Full past scene, specific question
   - Output: Answer to question with relevant details
   - Constraint: Isolated context, no leakage

4. **Consistency Check Prompt**
   - Input: Recent facts, current event
   - Output: Any contradictions detected
   - Constraint: Must be fast, runs frequently

5. **Narrative Correction Prompt**
   - Input: Inconsistency description, resolution strategy
   - Output: Natural narrative text explaining/correcting
   - Constraint: Must feel diegetic

---

## Implementation Phases

### Phase 1: Core Scene System

**Goal**: Replace current message history with scene-based structure.

Tasks:

1. Implement Scene data structure
2. Add scene lifecycle management (start, active, end)
3. Implement scene summarization on scene end
4. Track token counts in scenes
5. Update action handler to work with scenes
6. Test scene transitions between types

### Phase 2: Energy-Token Integration

**Goal**: Make energy a direct function of token budget.

Tasks:

1. Implement energy configuration with token mappings
2. Calculate max scene length from current energy
3. Implement forced scene endings at token limits
4. Add energy-based warnings and UI feedback
5. Test energy depletion through scenes
6. Implement energy display that reflects token reality

### Phase 3: Day System

**Goal**: Implement day boundaries with compression.

Tasks:

1. Implement Day data structure
2. Add day lifecycle management
3. Implement day summarization from scene summaries
4. Track scene summary budget within day
5. Implement forced sleep at energy/budget exhaustion
6. Add day transition handling
7. Store completed days for later retrieval

### Phase 4: Vector Storage

**Goal**: Enable semantic search of past events.

Tasks:

1. Set up vector database (recommendation: Deno KV with embeddings, or external
   like Pinecone)
2. Generate embeddings for scenes and days on completion
3. Implement semantic search function
4. Add relevance scoring and filtering
5. Test retrieval accuracy

### Phase 5: Memory Retrieval

**Goal**: Allow players to recall past events with energy cost.

Tasks:

1. Implement memory retrieval pipeline
2. Add RECALL action type
3. Implement automatic memory triggers (entity encounter, location return)
4. Create memory narrativization (templates and generation)
5. Record memories in current scene
6. Test memory retrieval at different depths
7. Implement dedicated context window for deep retrieval

### Phase 6: Fact Store

**Goal**: Track structured assertions for consistency checking.

Tasks:

1. Implement Fact data structure
2. Extract facts from scenes automatically
3. Store facts with provenance
4. Implement fact querying
5. Add fact superseding logic
6. Connect facts to consistency checker

### Phase 7: Consistency Watcher

**Goal**: Detect and resolve contradictions.

Tasks:

1. Implement consistency checking logic
2. Add severity classification
3. Implement resolution strategies
4. Create narrative correction generation
5. Add dream budget management
6. Test consistency system with intentional contradictions
7. Tune false positive/negative rates

### Phase 8: Polish and Integration

**Goal**: Make the system feel cohesive and diegetic.

Tasks:

1. Add sleep/dream sequences
2. Tune energy costs for good pacing
3. Polish narrative transitions
4. Add player-facing memory UI
5. Implement save/load across sessions
6. Performance optimization
7. Comprehensive testing

---

## Success Criteria

### Functional Requirements

1. **Games can run for 100+ days** without context degradation
2. **NPCs remember past interactions** via retrieval system
3. **Narrative remains coherent** across sessions
4. **Contradictions are detected and resolved** without breaking immersion
5. **Energy system feels fair** and maps clearly to game pacing
6. **Memory recall is useful** and integrated into gameplay

### Performance Requirements

1. **Action latency < 10 seconds** for normal actions
2. **Scene summarization < 5 seconds**
3. **Memory retrieval < 15 seconds** for deep searches
4. **Storage growth is bounded** (old days compressed)

### Experience Requirements

1. **Player never feels AI "forgot"** important things
2. **Constraints feel like game mechanics**, not bugs
3. **Corrections feel like narrative**, not errors
4. **Energy management is strategic**, not tedious

---

## Open Questions for Implementation

1. **Vector DB choice**: Deno KV with embeddings? Pinecone? Postgres with
   pgvector?

2. **Embedding model**: Which model for scene/day embeddings? Local or API?

3. **Scene boundary UI**: How does player know a scene is ending? Warning
   system?

4. **Memory UI**: How does player initiate recall? Natural language? Menu?

5. **Dream content**: How elaborate should dream sequences be? Mini-games?

6. **Multi-player**: Does this system extend to multiple players in same world?

7. **Save format**: How to persist game state across server restarts? Export?

8. **Undo/rollback**: Should player be able to "undo" recent actions?

---

## Appendix: Migration from Current System

The current system has:

- `messageHistory: Message[]` with 20-message cap
- `World` with all entities
- Simple session storage in Deno KV

Migration path:

1. Wrap existing `messageHistory` in Scene structure
2. Add Day wrapper around existing game loop
3. Keep current `World` as entity store
4. Add parallel Fact extraction
5. Add vector storage for completed scenes
6. Gradually phase out raw message history

The existing `ActionEngine`, `Narrator`, and `GameService` can be adapted rather
than replaced.
