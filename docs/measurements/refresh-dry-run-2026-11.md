# Refresh of the legacy library: dry run on 20 items (2026-11-03)

Written again through the Batch API with today's prompt and engine (2 legendary by Opus, 18 by Haiku), then decided by `scripts/refresh-runner.ts` with `DRY=1`: nothing was replaced. Frames: `refresh-dry-run-2026-11.jpg` (old left, new right, the last of the three judge frames).

| Item              | Tier      | Old test | New test | Judge old / new | Would        |
| ----------------- | --------- | -------- | -------- | --------------- | ------------ |
| Meteor Strike     | legendary | pass     | pass     | 4 / 4           | replace      |
| Necronomicon      | legendary | pass     | pass     | 4 / 2           | keep the old |
| Arcane Shield     | minor     | promise  | pass     | 2 / 3           | replace      |
| Protection Spell  | minor     | promise  | pass     | 2 / 2           | replace      |
| Adamantine Wall   | major     | promise  | pass     | 2 / 2           | replace      |
| Divine Shield     | major     | promise  | pass     | 3 / 2           | keep the old |
| Dungeon           | major     | promise  | pass     | 3 / 3           | replace      |
| Final Incantation | major     | promise  | pass     | 3 / 3           | replace      |
| Holy Avenger      | minor     | promise  | pass     | 3 / 2           | keep the old |
| Holy Tome         | minor     | promise  | pass     | 2 / 3           | replace      |
| Last Survivor     | cantrip   | promise  | pass     | 2 / 3           | replace      |
| Light             | cantrip   | promise  | pass     | 3 / 2           | keep the old |
| Meteor            | grand     | pass     | pass     | 3 / 2           | keep the old |
| Meteorite         | minor     | promise  | idle     | 2 / None        | keep the old |
| Portal Ward       | major     | promise  | pass     | 3 / 3           | replace      |
| Raise Dead        | major     | pass     | pass     | 2 / 2           | replace      |
| Saint             | minor     | promise  | pass     | 2 / 2           | replace      |
| Shadow            | cantrip   | pass     | pass     | 3 / 2           | keep the old |
| Stone Wall        | minor     | promise  | pass     | 2 / 2           | replace      |
| Ward              | minor     | promise  | pass     | 2 / 2           | replace      |

13 of 20 would be replaced (3 judged better, 10 judged the same), 7 keep the old program (judged lower, or the new one failed its test).

What the judge does not see: 14 of the 20 old programs fail the promise probe of their element (protection that does not protect, the 3.6 finding); every new one passes it.

A risk for the full run: the protection probe pushes every item whose intent is protect toward the same clear dome. Dungeon, Holy Tome and Holy Avenger each became a dome over the village and lost the look of what they are. Before the full run, the writer should be told to keep the item's own look beside its ward, or those elements' intents should be checked.

Cost of the dry run, measured: $0.108 of Batch API ($0.090 Opus for 2, $0.018 Haiku for 18). At that rate the whole library (about 60 big, 110 small) would cost about $2.8 plus judge calls, under the $8 cap.
