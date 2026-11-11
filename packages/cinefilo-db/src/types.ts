import type { Instant } from '@especulati/cinefilo-core';

/** Everything impure the write path needs, injected by the shell (or a test). */
export interface DispatchEnv {
  now: Instant;
  wallMs: () => number;
  newOpId: () => string;
}

export interface DispatchOutcome {
  /** How many changes the decision made (0 for an idempotent no-op). */
  readonly changes: number;
}
