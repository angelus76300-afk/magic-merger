let container: HTMLElement | null = null;

export function toast(message: string, tone: "info" | "special" | "error" = "info"): void {
  container ??= document.getElementById("toasts");
  if (!container) return;
  placeBelowHeader(container);
  // The same words already on screen are not stacked again: three taps on
  // empty ground in World gave three identical hints (2026-11-07).
  if ([...container.children].some((c) => c.textContent === message && !c.classList.contains("leaving"))) return;
  const node = document.createElement("div");
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  container.appendChild(node);
  window.setTimeout(
    () => {
      node.classList.add("leaving");
      node.addEventListener("animationend", () => node.remove(), { once: true });
    },
    tone === "error" ? 4000 : 2500,
  );
}

// Toasts sit just under the header. On a phone the tab bar wraps to the
// header's second row, so a fixed offset covered Challenges and Daily after
// a first merge (night frame 02-after-merge, 2026-11-06): measured instead.
function placeBelowHeader(box: HTMLElement): void {
  const header = document.querySelector(".topbar");
  const bottom = header ? header.getBoundingClientRect().bottom : 0;
  box.style.top = `${Math.max(8, Math.round(bottom) + 8)}px`;
}
