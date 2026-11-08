// 4.8: the sound settings cross into the World's frame. The frame is
// sandboxed with no origin, so it cannot read this page's storage: it asks
// for the settings when it starts, and the ? menu sends each change. Only
// volumes and switches go this way, nothing private.

import { readSoundSettings, type SoundSettings } from "./sim/soundsettings";

export const ASK = "sound-settings?";
export const SEND = "sound-settings";

function frames(): Window[] {
  return [...document.querySelectorAll("iframe")].map((f) => f.contentWindow).filter((w): w is Window => !!w);
}

// Every frame of this page gets the settings now.
export function sendSoundSettings(settings: SoundSettings = readSoundSettings()): void {
  for (const w of frames()) w.postMessage({ type: SEND, settings }, "*");
}

let listening = false;

export function answerSoundAsks(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (e: MessageEvent<unknown>) => {
    // Only a frame of this page, asking with the one question it may ask.
    if (!e.source || !(e.data && typeof e.data === "object" && (e.data as { type?: unknown }).type === ASK)) return;
    const from = frames().find((w) => w === e.source);
    from?.postMessage({ type: SEND, settings: readSoundSettings() }, "*");
  });
}
