import { useSignal } from "@preact/signals";
import type { Action, Entity, GameInitResponse } from "@/lib/game/types.ts";

export default function WorldExplorer() {
  const lines = useSignal<Array<{ type: string; text: string }>>([
    { type: "system", text: "=== WORLD EXPLORER: Text Adventure ===" },
    {
      type: "system",
      text: "Enter a world description or press Enter for default:",
    },
  ]);
  const input = useSignal("");
  const loading = useSignal(false);
  const gamePhase = useSignal<"init" | "char_select" | "playing">("init");
  const sessionData = useSignal<GameInitResponse | null>(null);
  const availableActions = useSignal<Action[]>([]);

  const addLine = (type: string, text: string) => {
    lines.value = [...lines.value, { type, text }];
    // Auto-scroll
    setTimeout(() => {
      const output = document.getElementById("game-output");
      if (output) output.scrollTop = output.scrollHeight;
    }, 10);
  };

  const handleSubmit = async (e: Event) => {
    console.log("Form submitted");
    e.preventDefault();
    if (loading.value) return;

    const value = input.value.trim();
    input.value = "";

    if (gamePhase.value === "init") {
      console.log("Initializing game with description:", value);
      await initGame(value || "Lord of the Rings, at The Shire");
    } else if (gamePhase.value === "char_select") {
      const idx = parseInt(value) - 1;
      if (idx >= 0 && sessionData.value?.availableCharacters?.[idx]) {
        await selectCharacter(sessionData.value.availableCharacters[idx].id);
      }
    } else if (gamePhase.value === "playing") {
      const idx = parseInt(value) - 1;
      if (idx >= 0 && availableActions.value[idx]) {
        await performAction(availableActions.value[idx]);
      }
    }
  };

  const initGame = async (description: string) => {
    loading.value = true;
    addLine("user", `> ${description}`);
    addLine("system", "Generating world...");

    try {
      const res = await fetch("/api/game/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldDescription: description }),
      });

      if (!res.ok) throw new Error("Failed to initialize game");

      const data = await res.json();
      sessionData.value = data;

      addLine("game", `=== ${data.world.world_name} ===`);
      addLine("game", data.world.world_description);
      addLine("game", "");
      addLine("game", data.openingScene);
      addLine("system", "");
      addLine("system", "Choose your character:");

      data.availableCharacters.forEach((char: Entity, i: number) => {
        addLine("system", `${i + 1}. ${char.name} - ${char.description}`);
      });

      gamePhase.value = "char_select";
    } catch (err: unknown) {
      addLine(
        "error",
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      addLine("system", "Please try again.");
    } finally {
      loading.value = false;
    }
  };

  const selectCharacter = async (characterId: string) => {
    loading.value = true;
    addLine("system", "Selecting character...");

    try {
      const res = await fetch("/api/game/select-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });

      if (!res.ok) throw new Error("Failed to select character");

      const data = await res.json();
      availableActions.value = data.availableActions;

      addLine("system", `You are now playing as ${data.character.name}`);
      addLine("system", "");
      displayActions();

      gamePhase.value = "playing";
    } catch (err: unknown) {
      addLine(
        "error",
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      loading.value = false;
    }
  };

  const performAction = async (action: Action) => {
    loading.value = true;
    addLine("user", `> ${action.description}`);

    try {
      const res = await fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) throw new Error("Failed to perform action");

      const data = await res.json();

      addLine("game", data.narration);
      addLine("system", "");

      if (data.gameOver) {
        addLine("system", "=== GAME OVER ===");
        addLine("system", data.gameOverReason || "The game has ended.");
        gamePhase.value = "init";
      } else {
        addLine(
          "system",
          `Health: ${data.gameState.health}/100 | Energy: ${data.gameState.energy}/100`,
        );
        availableActions.value = data.availableActions;
        displayActions();
      }
    } catch (err: unknown) {
      addLine(
        "error",
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      loading.value = false;
    }
  };

  const displayActions = () => {
    addLine("system", "What do you do?");
    availableActions.value.forEach((action, i) => {
      addLine("system", `${i + 1}. ${action.description}`);
    });
  };

  const getLineClass = (type: string) => {
    switch (type) {
      case "error":
        return "text-red-400";
      case "user":
        return "text-yellow-300";
      case "game":
        return "text-cyan-400";
      default:
        return "text-green-400";
    }
  };

  return (
    <div class="min-h-screen bg-black text-green-400 font-mono p-4">
      <div class="max-w-4xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
        <div
          id="game-output"
          class="flex-1 overflow-y-auto mb-4 border border-green-400 p-4 bg-gray-900"
        >
          {lines.value.map((line, i) => (
            <div key={i} class={`mb-1 ${getLineClass(line.type)}`}>
              {line.text}
            </div>
          ))}
          {loading.value && (
            <div class="text-green-400 animate-pulse">Processing...</div>
          )}
        </div>
        <form onSubmit={handleSubmit} class="flex gap-2">
          <span class="text-green-400">&gt;</span>
          <input
            type="text"
            value={input.value}
            onInput={(e) => {
              e.preventDefault();
              return input.value = (e.target as HTMLInputElement).value;
            }}
            disabled={loading.value}
            class="flex-1 bg-transparent outline-none text-green-400"
            placeholder={gamePhase.value === "init"
              ? "Enter world description..."
              : gamePhase.value === "char_select"
              ? "Enter character number..."
              : "Enter action number..."}
            autofocus
          />
        </form>
      </div>
    </div>
  );
}
