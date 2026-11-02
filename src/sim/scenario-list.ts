// What the game page shows about each challenge. Kept apart from the
// simulation so the page does not load the engine just to list them.
export interface ScenarioInfo {
  id: string;
  title: string;
  brief: string;
  // Kinds of spells that work, shown after a loss.
  hint: string;
}

export const SCENARIO_LIST: ScenarioInfo[] = [
  {
    id: "wildfire",
    title: "The forest is burning",
    brief:
      "A wildfire is racing through the forest toward the village, pushed by the wind. Put it out before it reaches the houses: if two burn, the village is lost.",
    hint: "Water, ice, rain, a firebreak, or turning the wind.",
  },
  {
    id: "lava",
    title: "The mountain wakes",
    brief: "The volcano above the village is erupting for a minute. Keep the lava out of the village until it falls quiet.",
    hint: "Walls and hills, a trench, cold or water to harden the lava into stone.",
  },
  {
    id: "river",
    title: "The river crossing",
    brief: "Eight travelers are stuck on the north bank, and their homes are across a deep river. Bring at least four of them home.",
    hint: "Freeze the river, raise a bridge or a ford, lift them across, or send them there.",
  },
  {
    id: "drought",
    title: "The great drought",
    brief: "The fields around the village have turned to dust. Bring water and life back to most of the farmland.",
    hint: "Rain or water on the fields, then anything that makes things grow.",
  },
  {
    id: "flood",
    title: "The rising sea",
    brief: "The sea will rise for fifty seconds and flood the low village. Keep at least half of the villagers alive.",
    hint: "Walls and dikes, higher ground, ice, or lifting people out of reach.",
  },
];
