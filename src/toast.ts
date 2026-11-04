let container: HTMLElement | null = null;

export function toast(message: string, tone: "info" | "special" | "error" = "info"): void {
  container ??= document.getElementById("toasts");
  if (!container) return;
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
