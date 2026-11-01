import Anthropic from "@anthropic-ai/sdk";
import type { Delivery, Effect, Emitter, Scale, SpellSpec, Verb } from "../shared/spell";
import { SCALES } from "../shared/spell";
import type { ElementKind } from "../shared/types";
import {
  DESCRIBE_SYSTEM,
  MERGE_SCHEMA,
  MERGE_SYSTEM,
  SPELL_SCHEMA,
  SPELL_SYSTEM,
  describeUserMessage,
  mergeUserMessage,
  spellUserMessage,
} from "./prompts";

export interface MergeAnswer {
  name: string;
  emoji: string;
  kind: ElementKind;
}

export interface SpellRequest {
  name: string;
  description: string;
  recipe: [string, string] | null;
  maxScale: Scale;
}

// Whatever decides what two items make, how an item is described, and how a
// spell looks and acts. The spell answer is raw: the caller sanitizes it.
export interface Oracle {
  readonly mock: boolean;
  merge(a: string, b: string): Promise<MergeAnswer>;
  describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string>;
  spell(request: SpellRequest): Promise<unknown>;
}

export interface OracleModels {
  merge: string;
  describe: string;
  spell: string;
  spellEffort: Effort;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function parseEffort(raw: string | undefined, fallback: Effort): Effort {
  return EFFORTS.includes(raw as Effort) ? (raw as Effort) : fallback;
}

export class OracleError extends Error {}

// Models that accept the server side refusal fallback. Haiku 5.5 has none, and
// sending the option to it would be rejected.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

function fallbackFor(model: string) {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
}

export class ClaudeOracle implements Oracle {
  readonly mock = false;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: OracleModels,
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 2 });
  }

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const response = await this.client.beta.messages.create({
      model: this.models.merge,
      max_tokens: 4000,
      ...fallbackFor(this.models.merge),
      output_config: { effort: "low", format: { type: "json_schema", schema: MERGE_SCHEMA } },
      // The system prompt never changes, so it is cached across merges.
      system: [{ type: "text", text: MERGE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: mergeUserMessage(a, b) }],
    });
    logUsage("merge", response);
    const { name, emoji, kind } = parseJson(readText(response)) as Partial<MergeAnswer>;
    if (typeof name !== "string" || typeof emoji !== "string" || (kind !== "spell" && kind !== "artifact")) {
      throw new OracleError("The merge answer did not match the schema");
    }
    return { name, emoji, kind };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.models.describe,
      max_tokens: 4000,
      ...fallbackFor(this.models.describe),
      output_config: { effort: "low" },
      system: [{ type: "text", text: DESCRIBE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: describeUserMessage(name, kind, recipe) }],
    });
    logUsage("describe", response);
    return readText(response).trim();
  }

  async spell(request: SpellRequest): Promise<unknown> {
    // Spells are generated once and kept forever, so this call gets more thought.
    const response = await this.client.beta.messages.create({
      model: this.models.spell,
      max_tokens: 16000,
      ...fallbackFor(this.models.spell),
      output_config: { effort: this.models.spellEffort, format: { type: "json_schema", schema: SPELL_SCHEMA } },
      system: [{ type: "text", text: SPELL_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: spellUserMessage(request.name, request.description, request.recipe, request.maxScale),
        },
      ],
    });
    logUsage("spell", response);
    return parseJson(readText(response));
  }
}

// Dollars per million tokens: input, output, cache read, cache write (5 minute TTL).
// Thinking is billed as output. Check https://platform.claude.com/docs/en/about-claude/pricing
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

// One JSON line per call, visible with `wrangler tail` and in Workers Logs, so the
// real cost of each kind of call can be measured instead of guessed.
function logUsage(call: string, response: Anthropic.Beta.BetaMessage): void {
  const u = response.usage;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const price = PRICES[response.model];
  const usd = price
    ? (input * price[0] + output * price[1] + cacheRead * price[2] + cacheWrite * price[3]) / 1e6
    : null;
  console.log(
    JSON.stringify({ usage: call, model: response.model, stop: response.stop_reason, input, output, cacheRead, cacheWrite, usd }),
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new OracleError("The answer was not valid JSON");
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

  // Builds a plausible spell from keywords in the name, so every verb and
  // delivery of the engine can be exercised without an API key.
  async spell(request: SpellRequest): Promise<SpellSpec> {
    const words = request.name.toLowerCase();
    const themes = MOCK_THEMES.filter((t) => t.words.some((w) => words.includes(w)));
    if (!themes.length) themes.push(MOCK_THEMES[MOCK_THEMES.length - 1]);
    const colors = themes.flatMap((t) => t.colors).slice(0, 4);
    const effects = themes.flatMap((t) => t.effects).slice(0, 5);
    const delivery: Delivery =
      MOCK_DELIVERIES.find(([w]) => words.includes(w))?.[1] ?? themes.find((t) => t.delivery)?.delivery ?? "burst";
    const scale = SCALES[Math.min(SCALES.indexOf(request.maxScale), 2 + (hash(words) % 3))];
    const emitter = (pattern: Emitter["pattern"], count: number, speed: number, gravity: number): Emitter => ({
      pattern,
      colors,
      count,
      speed,
      gravity,
      lifetime: 0.9,
      size: 1,
      glow: true,
    });
    return {
      summary: `Mock spell built from the words in "${request.name}".`,
      scale,
      delivery,
      incantation: { rings: 1 + (hash(words) % 3), symmetry: 3 + (hash(words) % 8), runes: 8, primary: colors[0], secondary: colors[1] ?? "#ffffff", spin: 1 },
      phases: {
        charge: { duration: 0.8, emitters: [emitter("spiral", 50, 8, -4)] },
        travel: { duration: 0.6, emitters: [emitter("trail", 80, 4, 0)] },
        release: { duration: 0.3, emitters: [emitter("burst", 120, 30, 5)] },
        linger: { duration: 2.5, emitters: [emitter(delivery === "rain" ? "rain" : "sparkle", 150, 6, -2)] },
      },
      effects,
    };
  }
}

const effect = (verb: Verb, strength: number, duration = 0, extra: Partial<Effect> = {}): Effect => ({
  verb,
  strength,
  duration,
  shape: "circle",
  material: "none",
  creature: "none",
  ...extra,
});

const MOCK_THEMES: { words: string[]; colors: string[]; effects: Effect[]; delivery?: Delivery }[] = [
  { words: ["fire", "flame", "inferno", "burn", "ember", "blaze"], colors: ["#ff7a1a", "#ffd166"], effects: [effect("ignite", 0.8, 3)] },
  { words: ["lava", "magma", "volcan"], colors: ["#ff4d00", "#7a1f00"], effects: [effect("spawn", 0.6, 0, { material: "lava" })], delivery: "rain" },
  { words: ["water", "rain", "tide", "flood", "wave"], colors: ["#4cc9f0", "#a9def9"], effects: [effect("spawn", 0.5, 2, { material: "water" })], delivery: "rain" },
  { words: ["ice", "frost", "snow", "freeze", "cold"], colors: ["#bde0fe", "#ffffff"], effects: [effect("freeze", 0.8, 4), effect("cool", 0.9)] },
  { words: ["steam", "mist", "fog"], colors: ["#e5e5e5", "#bde0fe"], effects: [effect("spawn", 0.4, 1, { material: "steam" })] },
  { words: ["earth", "stone", "rock", "golem"], colors: ["#8d6e63", "#bcaaa4"], effects: [effect("spawn", 0.5, 0, { material: "stone", shape: "ground" }), effect("summon", 0.2, 0, { creature: "golem" })] },
  { words: ["quake", "tremor"], colors: ["#795548", "#d7ccc8"], effects: [effect("quake", 0.7, 2, { shape: "ground" })], delivery: "wave" },
  { words: ["air", "wind", "storm", "gust", "tornado"], colors: ["#caf0f8", "#90e0ef"], effects: [effect("push", 0.8), effect("levitate", 0.5, 2)] },
  { words: ["light", "sun", "holy", "heal", "radian"], colors: ["#fff3b0", "#ffd166"], effects: [effect("heal", 0.8, 2), effect("revive", 0.5)], delivery: "beam" },
  { words: ["shadow", "dark", "night", "void", "eclipse"], colors: ["#3c096c", "#9d4edd"], effects: [effect("fear", 0.8, 5), effect("erase", 0.3)] },
  { words: ["life", "grow", "nature", "forest", "bloom"], colors: ["#80ed99", "#38b000"], effects: [effect("grow_plants", 0.8, 2), effect("summon", 0.3, 0, { creature: "beast" })] },
  { words: ["sleep", "dream", "calm"], colors: ["#cdb4db", "#ffc8dd"], effects: [effect("sleep", 0.9, 6), effect("calm", 0.8)] },
  { words: ["spirit", "ghost", "soul"], colors: ["#e0fbfc", "#98c1d9"], effects: [effect("summon", 0.4, 0, { creature: "spirit" })] },
  { words: ["crystal", "mana", "arcane", "magic"], colors: ["#b48cff", "#f4d58d"], effects: [effect("convert", 0.4, 0, { material: "crystal" }), effect("teleport", 0.5)] },
  { words: [], colors: ["#b48cff", "#ffffff"], effects: [effect("levitate", 0.6, 3), effect("damage", 0.2)] },
];

const MOCK_DELIVERIES: [string, Delivery][] = [
  ["bolt", "projectile"],
  ["ball", "projectile"],
  ["beam", "beam"],
  ["ray", "beam"],
  ["rain", "rain"],
  ["wave", "wave"],
  ["storm", "zone"],
];

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
