# Focus where you tap

When the camera is close, the depth of field focuses on the middle of the screen. A tap on a creature or a house could move the focus there for a few seconds, with a short pull of focus.

- What the player feels: the island answers the finger like a camera does; the thing they picked stands out, the rest goes quietly soft.
- What it adds: a reason to look at one villager closely, and a gentle hint of what was picked, without a new panel.
- What it costs: one depth read at the tapped point (the mixer already reads the depth at the screen middle), an eased value in `src/sim/voxel/looks.ts`, no new pass. Only on high, only at close zoom.
