import "./style.css";
import * as api from "./api";
import { Craft } from "./craft";
import { Store } from "./store";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const store = new Store();
const craft = new Craft(
  store,
  $("#board"),
  $("#inventory"),
  $("#inventory-list"),
  $<HTMLInputElement>("#search"),
  $("#count"),
);
craft.init();

$("#clear").addEventListener("click", () => craft.clearBoard());

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>(".tab")) {
      other.setAttribute("aria-selected", String(other === tab));
    }
    for (const view of document.querySelectorAll<HTMLElement>(".view")) {
      view.hidden = view.id !== tab.dataset.view;
    }
  });
}

void api.health().then((status) => {
  if (status?.mock) $("#mock-badge").hidden = false;
});
