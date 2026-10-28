// Table geometry shared by the layout, the cave and the scene.

export interface TableGeom { cx: number; cy: number; rx: number; ry: number }

/** Cells are about twice as tall as wide; distances in "cell widths" use this. */
export const ASPECT = 2.08;

/** Normalised elliptical distance from the table centre: < 1 is on the table. */
export function tableDist(t: TableGeom, x: number, y: number): number {
  return Math.hypot((x - t.cx) / t.rx, (y - t.cy) / t.ry);
}
