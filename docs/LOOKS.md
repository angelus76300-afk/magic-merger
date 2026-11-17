# How items should look

The rules for an item's look (`w.model`), from the owner's reference pictures of 13 November: rendered voxel dioramas (castles with crenellations and cone roofs, a cottage island with a well and barrels, a floating ruin with a glowing core, dark buildings with glowing seams and glass domes). The owner: "I hope we can make very beautiful ones."

The pictures are other people's art and are not in the repository. These rules are what can be learned from them.

## The base style

Buildings, creatures and props are drawn as a toy diorama: chunky but rich, flat colours, clear shapes, a saturated warm palette. This is the style a phone can draw well.

Magic is drawn in a second language: particles, blocks drifting off, glowing seams and cores, glass shells.

## Rules

0. **One small cube size for everything.** Objects and land are made of the same cube, an eighth of a land cell (the owner, 13 November: "they should be small cube voxels"; 15 November: "let's just keep 1/8 all the time"). A look that uses any new field is drawn as these cubes: a cone is a stepped spire, a dome a stepped shell, a turned part a staircased block. Lay parts on the grid of eighths (0, 0.125, 0.25 ...) so edges land where you mean them: a part one eighth wide that straddles two cubes can vanish (a thin round post centred on 0 is drawn as nothing). The reference looks end with an `eighths` helper that puts every edge on the grid.

1. **Small parts against the object.** A tower is 40 to 80 small steps tall, so trim, windows and ivy can be seen. Detail lives in parts of 0.05 to 0.3 of a cell.
2. **Silhouette first.** Crenellations, cone roofs, spires, arches, stepped bases. Never a plain box on top.
3. **Three to five tones of one hue per material, plus one accent.** Pink roofs on beige stone; cyan glow on grey stone and green.
4. **No large flat colour.** Stone, cliff and grass parts take `grain`, so each face is cut in tiles of slightly different tones.
5. **A living layer.** Ivy, moss, small trees and bushes around the base; water with a ring of foam.
6. **Light as a material.** Glowing water and motes, warm lit doorways and lamps: parts marked `glow`.
7. **Soft shadow in the corners.** Where parts meet, the corner darkens. The game bakes it per corner, once, when the look is built (any look that uses a new field gets it).
8. **Props tell a story.** A cottage has a well, barrels, a crate, a chair, steps. A figure reads at about 10 parts tall.
9. **Magic as disintegration.** Blocks drift off, sand pours, dust hangs, a glowing core shows through a doorway. This is how a spell looks while it acts.
10. **Dark mass and warm lines.** Dark buildings with lava seams or lit windows; glass domes holding a garden. A ward reads as a faint shell with a world inside.

## What the game can draw (phase 1)

A part is `[x, y, z, w, d, h, color, ...]` or `{x, y, z, w, d, h, color, ...}`, in cells across and up from the ground under the item. After the colour, a list can carry words and one object of fields; an object part carries the fields directly.

| Field      | What it does                                                                               |
| ---------- | ------------------------------------------------------------------------------------------ |
| `"glow"`   | The part shines (as before).                                                               |
| `shape`    | `"box"` (as before), `"wedge"`, `"cyl"`, `"cone"` or `"dome"`, filling the part's box.     |
| `rx`, `ry` | A tilt in degrees about the east-west and north-south lines through the part's center.     |
| `rz`       | A turn in degrees about the up line through the part's center.                             |
| `grain`    | `true` (0.08) or 0 to 0.3: each face cut in tiles of about half a cell, each its own tone. |

- A wedge is full height on its west side and slopes down to nothing on its east side. Two wedges back to back, one turned with `rz: 180`, make a roof.
- Every part of such a look is filled into cubes of an eighth of a cell (a quarter on the low preset). A part thinner than a cube is drawn one cube thick when it covers a cube's centre. A later part paints over an earlier one: put windows, doors and trim after the wall they sit on.
- Roofs read best as rows of tile cubes with a darker eave row and ridge; walls as a timber frame in a contrasting colour; windows set one cube behind the frame; greenery hanging off edges (the reference cottage).
- A model keeps 160 parts.
- Example, a tower: `[-0.5, -0.5, 0, 1, 1, 3, "#b8ab94", "cyl", "grain"]`, then a cone roof `[-0.6, -0.6, 3, 1.2, 1.2, 1.2, "#c8606a", "cone"]`.

## Cost

Faces of cubes that touch, match in colour and share their corner shade are merged, so a flat wall of one colour costs a few triangles. Grain gives every cube its own tone, so a grainy face cannot merge: use it on stone, grass and roofs, not on everything.

The island draws its props within 90,000 triangles, the looks nearest the camera first. Past that, a far look is drawn with cubes twice the size (a stored look of plain boxes draws its 24 largest parts). A look of 160 domes with grain is expensive: draw large surfaces with few parts and grain, and spend parts on the silhouette.

## Honest limits

The references are offline path-traced renders. A phone at 30 frames a second will not match them. What carries over: the scale of detail, the silhouette, the palette, colour noise, soft shadow in the corners, and glow.

## Reference looks

Ten hand-made looks in `shared/looks/` set the level of detail the writer copies: a spellbook, a potion, a sword in the stone and a seeing orb (objects, 25 to 33 parts), a wolf and a hawk (creatures, 33 to 39), a mage tower and a shrine (buildings, 60 to 76), a spirit tree and a ruined temple (places, 82 to 89). Each is the piece of a cast that draws it, shown to the writer as written, three at a time by kind (`referencesFor`). Frames at medium: `docs/visual-checks/looks-references/` (`scripts/looks-references-frames.ts`). Their checks (`scripts/looks-refs-test.ts`): parts within the kind's range, three tones or more of one hue, a glowing accent under a third of the parts, three shapes or more, and an outline richer than the library's median or a shape that is not a block.

## Items that draw no model

Phase 0 counted 307 of 368 items that draw no `w.model` (the owner, 17 November: "looks: all items"). Nothing stands in for them on the island: an artifact is a landmark, which the island does not draw, so what shows is only what the program raises (voxels, particles, land). The look-only writer may give such a program one model, inserted and nothing else changed (`shared/looks/splice.ts`, `PROGRAM_ADD`; `insertedText` proves it):

- An artifact's model goes right after the `w.artifact(x, y, ...)` statement of the cast's own block, at the same x and y, so it appears when the artifact does and a hand that takes the artifact takes its model. If that place is in a loop or a branch, or its x or y holds a call or an assignment (read twice it could act twice), the model goes at the start of the cast, at the cast's point.
- It takes the item's name (`w.model`'s default) and one model at most; a wonder keeps its one or two named looks at its center.
- None for a creature (its body is its look), nor for a program that calls `w.building`, `w.village` or `w.wonder` (the island draws those already): a model there would draw the item twice.
- None for a spell unless the admin asks (`spells: true`, `looks-runner start --pilot --spells`): a spell's model stays where each cast fell, and the island keeps 60 models, so a spell cast often would push placed items' looks off.

The pilot is picked by the runner from the live library (`GET /api/admin/looks-pool`, one SELECT, `shared/looks/pilot.ts`): the 10 plainest items that draw a model, the 10 most cast that may gain one, and 10 wonders.
