// Planar polygon helpers shared by board (connectivity) and extraction (meshing), mm.
import { Clipper64, PolyTree64, ClipType, FillRule, type PolyPath64, type Paths64 } from 'clipper2-ts'
import type { CopperPoint as Point, CopperPolygon as Polygon, RoutedCopper } from './types'

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

/** Unions touching or overlapping ground pours on the same copper layer before meshing. */
export function unionLayerPours(rawPours: RoutedCopper['pours']): RoutedCopper['pours'] {
  const byLayer = new Map<string, RoutedCopper['pours']>()
  for (const pour of rawPours) {
    const group = byLayer.get(pour.layer) ?? []
    group.push(pour)
    byLayer.set(pour.layer, group)
  }
  const scale = 1e12
  return [...byLayer.entries()].flatMap(([layerName, layerPours]) => {
    if (layerPours.length === 1) return layerPours
    const engine = new Clipper64()
    const tree = new PolyTree64()
    const paths: Paths64 = layerPours.flatMap(p => p.polygon.map((ring, i) => {
      const oriented = ringArea(ring) * (i ? -1 : 1) > 0 ? ring : [...ring].reverse()
      return oriented.map(([x, y]) => ({ x: Math.round(x * scale), y: Math.round(y * scale) }))
    }))
    engine.addSubject(paths)
    if (!engine.execute(ClipType.Union, FillRule.NonZero, tree)) return layerPours
    /** Converts one Clipper path node back to millimetre coordinates. */
    const ringPoints = (node: PolyPath64): Point[] => node.polygon!.map(p => [p.x / scale, p.y / scale] as Point)
    const unioned: Polygon[] = []
    /** Collects outer polygon nodes and their immediate hole children from the Clipper tree. */
    const visit = (node: PolyPath64): void => {
      if (node.polygon && !node.isHole) {
        const rings = [ringPoints(node), ...Array.from({ length: node.count }, (_, i) => ringPoints(node.child(i)))]
        unioned.push(rings.map((ring, i) => ringArea(ring) * (i ? -1 : 1) > 0 ? ring : ring.reverse()))
      }
      for (let i = 0; i < node.count; i++) visit(node.child(i))
    }
    visit(tree)
    return unioned.map(polygon => ({
      ...layerPours[0],
      pcbCopperPourId: layerPours.map(p => p.pcbCopperPourId).join('+'),
      layer: layerName,
      polygon,
    }))
  })
}
