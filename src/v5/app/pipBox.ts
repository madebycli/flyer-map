/** Geometry of the brainrot window (see `focusVideo.tsx`): a 16:9 box kept on the screen and settled in the nearest corner. */
export const MARGIN = 12, MIN_W = 140, RATIO = 9 / 16;

export type PipBox = { x: number; y: number; w: number };
const maxWidth = (vw: number) => Math.max(MIN_W, Math.min(vw - 2 * MARGIN, 560));

/** The window kept inside the screen: its width between the smallest size and the widest that fits, every edge at least `MARGIN` from the border. */
export function clampBox(b: PipBox, vw: number, vh: number): PipBox {
  const w = Math.min(Math.max(b.w, MIN_W), maxWidth(vw));
  const h = w * RATIO;
  return { w, x: Math.min(Math.max(b.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN)), y: Math.min(Math.max(b.y, MARGIN), Math.max(MARGIN, vh - h - MARGIN)) };
}

/** The corner (margin from every edge) the window is nearest to. */
export function snapBox(b: PipBox, vw: number, vh: number): PipBox {
  const c = clampBox(b, vw, vh), h = c.w * RATIO;
  const left = c.x + c.w / 2 < vw / 2, top = c.y + h / 2 < vh / 2;
  return { w: c.w, x: left ? MARGIN : vw - c.w - MARGIN, y: top ? MARGIN : vh - h - MARGIN };
}

