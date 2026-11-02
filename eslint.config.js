import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

// The simulation (src/sim, without the host files and the voxel view) must run
// without a browser: npm test runs it in Node. So it never imports the view or
// three.js, and modules never import each other in a loop.
const SIMULATION = ["src/sim/*.ts"];
const HOST = ["src/sim/engine.ts", "src/sim/frame.ts", "src/sim/hud.ts", "src/sim/protocol.ts"];

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".wrangler", "lab/legacy", "lab/spells", "lab/solutions", "**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-cycle": ["error", { ignoreExternal: true, allowUnsafeDynamicCyclicDependency: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Spell programs are untrusted code compiled on purpose (runtime.ts).
      "@typescript-eslint/no-implied-eval": "off",
      "no-new-func": "off",
    },
    settings: {
      "import-x/resolver": { node: { extensions: [".ts"] } },
      "import-x/parsers": { "@typescript-eslint/parser": [".ts"] },
      "import-x/extensions": [".ts"],
    },
  },
  {
    files: SIMULATION,
    ignores: HOST,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["./voxel/*", "../voxel/*", "**/voxel/*"], message: "The simulation must not import the view: npm test runs it in Node." },
            { group: ["three", "three/*"], message: "The simulation must not depend on three.js." },
          ],
        },
      ],
    },
  },
);
