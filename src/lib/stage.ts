import type { Fixture } from "./store"

/** x, y, z in metres. The stage faces +z (the audience); y is up. */
export type Vec3 = [number, number, number]

export const DEG = 180 / Math.PI

const isVec3 = (v: unknown): v is Vec3 =>
	Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))

/**
 * Spots on the loaded stage where lights used to hang (the trusses' real fixture positions), in the
 * order new lights should fill them. Empty when no stage model is loaded.
 */
let hangPoints: Vec3[] = []
export const setHangPoints = (points: Vec3[]): void => {
	hangPoints = points
}
export const getHangPoints = (): Vec3[] => hangPoints

/** A row of lights along a truss, tilted a little toward the back wall (used with no stage, or past the last hang point). */
function rowSlot(index: number, count: number): { pos: Vec3; rot: Vec3 } {
	const spacing = 1.6
	return { pos: [(index - (count - 1) / 2) * spacing, 4.1, -1.2], rot: [0.35, 0, 0] }
}

/**
 * Where a light starts in the 3D stage until the user moves it. With a stage loaded, lights fill
 * its truss positions; otherwise they sit in a row. A light points along its own -Y, so rotation
 * [0,0,0] means "straight down".
 */
export function defaultTransform(index: number, count: number): { pos: Vec3; rot: Vec3 } {
	const hang = hangPoints[index]
	if (hang) return { pos: [hang[0], hang[1], hang[2]], rot: [0.3, 0, 0] }
	const spill = Math.max(0, count - hangPoints.length)
	return rowSlot(index - hangPoints.length, spill)
}

/** A fixture's position and rotation (radians), falling back to its default slot. */
export function fixtureTransform(f: Fixture, index: number, count: number): { pos: Vec3; rot: Vec3 } {
	const d = defaultTransform(index, count)
	return { pos: isVec3(f.pos) ? f.pos : d.pos, rot: isVec3(f.rot) ? f.rot : d.rot }
}

/** Keep only a valid position/rotation from saved data. */
export const cleanVec3 = (v: unknown): Vec3 | undefined => (isVec3(v) ? [v[0], v[1], v[2]] : undefined)
