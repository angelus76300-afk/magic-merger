// Island sizes, cells across. 4.4: huge and giant, offered only where the
// device's own frame numbers show the headroom (src/headroom.ts).
export const WORLD_SIZES = { small: 112, medium: 152, large: 208, huge: 288, giant: 384 } as const;
export type WorldSize = keyof typeof WORLD_SIZES;
