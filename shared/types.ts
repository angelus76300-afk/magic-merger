// Types shared by the browser and the Worker.
import type { SpellSpec } from "./spell";

// A spell can be cast in the World tab. An artifact is anything magical that
// cannot be cast: an object, material, creature, place, person or idea.
export type ElementKind = "spell" | "artifact";

export interface GameElement {
  name: string;
  emoji: string;
  kind: ElementKind;
  // Number of merges between this element and the primitives. Primitives are 0.
  depth: number;
}

export interface MergeRequest {
  a: string;
  b: string;
}

export interface MergeResponse {
  element: GameElement;
  // True when this merge created the element for the first time ever.
  firstDiscovery: boolean;
  // True when the Worker answered without calling Claude (no API key set).
  mock: boolean;
}

export interface DescribeRequest {
  name: string;
  // Admin only: throw away the stored text and write a new one.
  regenerate?: boolean;
}

export interface DescribeResponse {
  name: string;
  description: string;
  mock: boolean;
}

export interface SpellRequest {
  name: string;
  // Admin only: throw away the stored spec and design the spell again.
  regenerate?: boolean;
}

export interface SpellResponse {
  name: string;
  spec: SpellSpec;
  mock: boolean;
}

export interface HealthResponse {
  ok: boolean;
  mock: boolean;
  admin: boolean;
}

export interface ApiError {
  error: string;
}
