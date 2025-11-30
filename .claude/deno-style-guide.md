# Deno Style Guide for This Project

This project follows the
[official Deno Style Guide](https://docs.deno.com/runtime/contributing/style_guide/).

## File Naming Conventions

### Use `mod.ts` Instead of `index.ts`

Deno does not treat `index.ts` or `index.js` specially. Use `mod.ts` as the
default entry point for directories:

```
# Good
lib/game/session/mod.ts

# Bad
lib/game/session/index.ts
```

### Use `snake_case` for Filenames

```
# Good
kv_session_manager.ts
action_selector.ts
mock_client.ts

# Bad
kv-session-manager.ts
kvSessionManager.ts
```

### Test Files Use `*_test.ts` Suffix

```
# Good
transaction_test.ts
engine_test.ts

# Bad
transaction.test.ts
engine.spec.ts
```

### Internal Modules Use Underscore Prefix

Files or directories with unstable APIs that shouldn't be imported externally:

```
# Good - indicates internal/unstable API
lib/game/_testing/
lib/game/_internal.ts

# Bad
lib/game/__testing__/
lib/game/internal/
```

## Code Style

### Top-Level Functions Use `function` Keyword

```typescript
// Good
export function calculateEnergy(tokens: number): number {
  return Math.ceil(tokens / 40);
}

// Bad - arrow function at top level
export const calculateEnergy = (tokens: number): number => {
  return Math.ceil(tokens / 40);
};
```

Arrow functions are fine for closures and callbacks.

### Export All Interfaces Used in Public API

```typescript
// Good - export the options interface
export interface ProcessOptions {
  timeout?: number;
  retries?: number;
}

export function process(data: string, options?: ProcessOptions): void {
  // ...
}

// Bad - inline interface not exported
export function process(
  data: string,
  options?: { timeout?: number; retries?: number },
): void {
  // ...
}
```

### Max 2 Required Arguments + Options Object

```typescript
// Good
export function createSession(
  worldDescription: string,
  options?: { ttl?: number; metadata?: Record<string, unknown> },
): Session {
  // ...
}

// Bad - too many positional arguments
export function createSession(
  worldDescription: string,
  ttl: number,
  metadata: Record<string, unknown>,
  validate: boolean,
): Session {
  // ...
}
```

### JSDoc on All Exported Symbols

```typescript
/** Creates a new game session with the given world description. */
export function createSession(description: string): Session {
  // ...
}

/**
 * Manages transaction state for world mutations.
 * Changes are accumulated and can be committed or rolled back.
 */
export class TransactionManager {
  // ...
}
```

Use single-line JSDoc when possible. Avoid `@param` tags unless parameters are
non-obvious.

## Module Organization

### Test Files Are Siblings to Source Files

```
lib/game/
├── engine.ts
├── engine_test.ts        # Test is sibling, not in separate folder
├── validation.ts
└── validation_test.ts
```

### Module Entry Points Export Public API

```typescript
// lib/game/session/mod.ts
export { KvSessionManager } from "./kv_session_manager.ts";
export { MockSessionManager } from "./mock_session_manager.ts";
export type { ISessionManager, SessionData } from "./interface.ts";
```

## Mock Organization (Hybrid Approach)

### Colocate Interface Mocks

Mocks that implement an interface live alongside the interface:

```
lib/game/session/
├── interface.ts
├── kv_session_manager.ts
├── mock_session_manager.ts    # Implements ISessionManager
└── mod.ts                     # Exports both real and mock

lib/game/llm/services/
├── interface.ts
├── narrator.ts
├── mock_narrator.ts           # Implements INarrator
└── mod.ts                     # Exports both real and mock
```

### Centralize Test Data Builders

Test data builders (not mocks) go in a shared `_testing/` directory:

```
lib/game/_testing/
├── builders.ts    # TestWorldBuilder, TestSessionBuilder, etc.
└── mod.ts
```

**Rule of thumb:**

- **Colocate** if it implements an interface from that module
- **Centralize** if it's pure test infrastructure (builders, fixtures, helpers)

## Naming Conventions

| Type                | Convention                              | Example                               |
| ------------------- | --------------------------------------- | ------------------------------------- |
| Files               | `snake_case`                            | `game_service.ts`                     |
| Functions/Variables | `camelCase`                             | `calculateEnergy()`                   |
| Classes/Types       | `PascalCase`                            | `TransactionManager`                  |
| Constants           | `UPPER_SNAKE_CASE`                      | `MAX_RETRIES`                         |
| Interfaces          | `PascalCase` with `I` prefix (optional) | `ISessionManager` or `SessionManager` |

### Acronyms Follow Case Convention

```typescript
// Good
HttpServer;
JsonParser;
UuidGenerator;

// Bad
HTTPServer;
JSONParser;
UUIDGenerator;
```

## Error Messages

- Sentence case, no trailing period
- Active voice
- Include relevant values in quotes

```typescript
// Good
throw new Error(`Entity not found: "${entityId}"`);
throw new Error("Cannot start transaction: existing transaction not completed");

// Bad
throw new Error("ENTITY NOT FOUND.");
throw new Error(
  `The entity with id ${entityId} could not be located in the system.`,
);
```

## TODO Comments

Reference issues or usernames:

```typescript
// TODO(sam): Add retry logic for network failures
// TODO(#123): Implement caching layer
```

## References

- [Deno Style Guide](https://docs.deno.com/runtime/contributing/style_guide/)
- [Deno Testing](https://docs.deno.com/runtime/manual/basics/testing/)
- [Deno Mocking Tutorial](https://docs.deno.com/examples/mocking_tutorial/)
