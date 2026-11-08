// Sound settings (4.8, item 8), kept per device. The ? menu writes them; the
// World's frame, sandboxed with no storage of its own, gets them by message
// from the page (soundbridge.ts).

export interface SoundSettings {
  // Off on a first visit: music is a choice.
  music: boolean;
  // 0 to 1.
  musicVolume: number;
  effectsVolume: number;
  ambienceVolume: number;
  // One channel for one ear or a single speaker.
  mono: boolean;
}

export const SOUND_DEFAULTS: SoundSettings = { music: false, musicVolume: 0.6, effectsVolume: 1, ambienceVolume: 0.7, mono: false };

const KEYS: Record<keyof SoundSettings, string> = {
  music: "magic-merger.music",
  musicVolume: "magic-merger.volume.music",
  effectsVolume: "magic-merger.volume.effects",
  ambienceVolume: "magic-merger.volume.ambience",
  mono: "magic-merger.mono",
};

// Settings sent by the page into the World's frame, checked field by field.
export function readSentSettings(data: unknown): SoundSettings | null {
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== "sound-settings") return null;
  const s = (data as { settings?: unknown }).settings;
  if (!s || typeof s !== "object") return null;
  const v = s as Record<string, unknown>;
  const level = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
  return {
    music: v.music === true,
    mono: v.mono === true,
    musicVolume: level(v.musicVolume, SOUND_DEFAULTS.musicVolume),
    effectsVolume: level(v.effectsVolume, SOUND_DEFAULTS.effectsVolume),
    ambienceVolume: level(v.ambienceVolume, SOUND_DEFAULTS.ambienceVolume),
  };
}

export function readSoundSettings(store: Pick<Storage, "getItem"> | null = safeStorage()): SoundSettings {
  const out = { ...SOUND_DEFAULTS };
  if (!store) return out;
  const flag = (k: keyof SoundSettings) => {
    const v = store.getItem(KEYS[k]);
    return v === null ? (SOUND_DEFAULTS[k] as boolean) : v === "1";
  };
  const level = (k: keyof SoundSettings) => {
    const v = Number(store.getItem(KEYS[k]));
    return store.getItem(KEYS[k]) === null || !Number.isFinite(v) ? (SOUND_DEFAULTS[k] as number) : Math.max(0, Math.min(1, v));
  };
  out.music = flag("music");
  out.mono = flag("mono");
  out.musicVolume = level("musicVolume");
  out.effectsVolume = level("effectsVolume");
  out.ambienceVolume = level("ambienceVolume");
  return out;
}

export function writeSoundSetting<K extends keyof SoundSettings>(
  key: K,
  value: SoundSettings[K],
  store: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    store?.setItem(KEYS[key], typeof value === "boolean" ? (value ? "1" : "0") : String(Math.round((value as number) * 100) / 100));
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
