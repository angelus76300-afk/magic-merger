import Anthropic from "@anthropic-ai/sdk";
import type { ElementKind } from "../shared/types";
import {
  DESCRIBE_SYSTEM,
  MERGE_SCHEMA,
  MERGE_SYSTEM,
  describeUserMessage,
  mergeUserMessage,
} from "./prompts";

export interface MergeAnswer {
  name: string;
  emoji: string;
  kind: ElementKind;
}

// Whatever decides what two items make and how an item is described.
export interface Oracle {
  readonly mock: boolean;
  merge(a: string, b: string): Promise<MergeAnswer>;
  describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string>;
}

export class OracleError extends Error {}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeOracle implements Oracle {
  readonly mock = false;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private mergeModel: string,
    private describeModel: string,
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 2 });
  }

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const response = await this.client.beta.messages.create({
      model: this.mergeModel,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: MERGE_SCHEMA } },
      // The system prompt never changes, so it is cached across merges.
      system: [{ type: "text", text: MERGE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: mergeUserMessage(a, b) }],
    });
    const text = readText(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OracleError("The merge answer was not valid JSON");
    }
    const { name, emoji, kind } = parsed as Partial<MergeAnswer>;
    if (typeof name !== "string" || typeof emoji !== "string" || (kind !== "spell" && kind !== "artifact")) {
      throw new OracleError("The merge answer did not match the schema");
    }
    return { name, emoji, kind };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.describeModel,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: DESCRIBE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: describeUserMessage(name, kind, recipe) }],
    });
    return readText(response).trim();
  }
}

function readText(response: Anthropic.Beta.BetaMessage): string {
  if (response.stop_reason === "refusal") {
    throw new OracleError("The magic refused to answer this one");
  }
  if (response.stop_reason === "max_tokens") {
    throw new OracleError("The answer was cut off");
  }
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text) throw new OracleError("The answer was empty");
  return text;
}

// Used when no API key is configured, so the game runs offline for UI work.
// Deterministic, obviously fake, never calls the network.
export class MockOracle implements Oracle {
  readonly mock = true;

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const [x, y] = [a, b].sort();
    if (x === y) return { name: `Greater ${lastWord(x)}`, emoji: "✨", kind: "spell" };
    const h = hash(`${x}+${y}`);
    const emoji = MOCK_EMOJI[h % MOCK_EMOJI.length];
    const kind: ElementKind = h % 3 === 0 ? "artifact" : "spell";
    const suffix = kind === "artifact" ? MOCK_ARTIFACTS[h % MOCK_ARTIFACTS.length] : MOCK_SPELLS[h % MOCK_SPELLS.length];
    return { name: `${firstWord(x)} ${firstWord(y)} ${suffix}`.split(" ").slice(-3).join(" "), emoji, kind };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string> {
    const origin = recipe ? `Born from ${recipe[0]} and ${recipe[1]}.` : "One of the primal forces.";
    return `${origin} This is a placeholder ${kind} description for ${name}. Set ANTHROPIC_API_KEY on the Worker to get real ones.`;
  }
}

const MOCK_EMOJI = ["🌀", "⚡", "🌟", "❄️", "🌊", "🔥", "🌿", "💀", "🪄", "💎"];
const MOCK_SPELLS = ["Bolt", "Ward", "Nova", "Surge", "Veil"];
const MOCK_ARTIFACTS = ["Stone", "Totem", "Rune", "Orb"];

function firstWord(s: string): string {
  return s.split(" ")[0];
}

function lastWord(s: string): string {
  const words = s.split(" ");
  return words[words.length - 1];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
