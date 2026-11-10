// Planar polygon helpers shared by board (connectivity) and extraction (meshing), mm.
import type { CopperPoint as Point, CopperPolygon as Polygon, CopperSegment as Segment } from './types'

/** Signed shoelace area of a ring: positive when counter-clockwise, so callers can fix winding. */
export const ringArea = (ring: Point[]): number => ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length]
  return s + p[0] * q[1] - q[0] * p[1]
}, 0) / 2
/** Copy of the ring with its first point repeated at the end, for formats that want closed loops. */
export const closeRing = (ring: Point[]): Point[] => [...ring, ring[0]]

const ringBounds=new WeakMap<Point[],[number,number,number,number]>()
/** Even-odd point-in-ring test, with a cached bounding box to reject far points quickly. */
function inRing(p: Point, ring: Point[]): boolean {
  let box=ringBounds.get(ring)
  if(!box) {
    box=[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]
    ringBounds.set(ring,box)
  }
  if(p[0]<box[0]||p[1]<box[1]||p[0]>box[2]||p[1]>box[3]) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
/** Point in outer ring and in no cutout. */
export const polygonContains = (p: Point, polygon: Polygon): boolean => inRing(p, polygon[0]) && !polygon.slice(1).some(ring => inRing(p, ring))

/** Joins consecutive sub-width horizontal trace segments on the same layer so curved arcs do not create overlapping FastHenry filaments. */
export function joinSubWidthSegments(segments: Segment[]): Segment[] {
  const joined: Segment[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const horizontal = Math.abs(s.a[2] - s.b[2]) < 1e-8 && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-10
    if (!horizontal) {
      joined.push(s)
      continue
    }
    let end = s.b
    while (i + 1 < segments.length) {
      const next = segments[i + 1]
      const nextHorizontal = Math.abs(next.a[2] - next.b[2]) < 1e-8 && Math.hypot(next.b[0] - next.a[0], next.b[1] - next.a[1]) > 1e-10
      if (!nextHorizontal || Math.abs(s.a[2] - next.a[2]) > 1e-8 || Math.abs(s.widthMm - next.widthMm) > 1e-8 || Math.abs(s.thicknessMm - next.thicknessMm) > 1e-8 || Math.hypot(end[0] - s.a[0], end[1] - s.a[1]) >= s.widthMm) break
      end = next.b
      i++
    }
    if (Math.hypot(end[0] - s.a[0], end[1] - s.a[1]) > 1e-10) joined.push({ ...s, b: end })
  }
  return joined
}
