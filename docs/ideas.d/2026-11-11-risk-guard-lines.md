section: Quality of life

- 2026-11-11: **A "what this change breaks" line in every pull request** (tooling, not a player feature; lens: the owner sees consequences, not classes): the classifier already knows which rule matched, so the pull request comment could say in one plain line what an amber or red means for players, for example "stored spells that call `burnVoxels` stop working" or "islands saved before this load differently". The owner then answers a sentence instead of reading a rule id. Cost: a sentence per rule in `scripts/risk.mjs`, no new running cost.
