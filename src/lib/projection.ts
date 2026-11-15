/**
 * Projection mapping: the data model and the maths.
 *
 * Everything lives in OUTPUT space, 0..1 across and down the projector's picture (y down). A layer takes
 * one video or live camera, pins its four corners onto a surface (a perspective warp), and cuts it out
 * with a polygon mask. Layers draw bottom to top over black; a "hole" layer blacks out what's beneath it.
 */

export type Pt = [number, number]
/** top-left, top-right, bottom-right, bottom-left */
export type Quad = [Pt, Pt, Pt, Pt]

export interface ProjSource {
	id: string
	kind: "video" | "camera"
	name: string
	/** a video file's path */
	path?: string
	/** a camera's device id */
	deviceId?: string
}

export interface ProjLayer {
	id: string
	name: string
	/** additive shows the source inside the mask; a hole blocks everything beneath it inside the mask */
	mode: "add" | "hole"
	sourceId: string | null
	/** where the source's four corners land (the corner pin) */
	corners: Quad
	/** the cut-out. Fewer than 3 points, or not closed: an additive layer shows its whole quad, a hole does nothing */
	mask: Pt[]
	closed: boolean
	/** softness of the mask edge, in pixels on a 1080-high picture */
	feather: number
}

export interface Projection {
	/** the projector's picture size (set from the display it pops out on) */
	width: number
	height: number
	sources: ProjSource[]
	layers: ProjLayer[]
}

export const MAX_LAYERS = 24
export const MAX_SOURCES = 16
export const MAX_MASK_POINTS = 64
export const MAX_FEATHER = 100

export function emptyProjection(): Projection {
	return { width: 1920, height: 1080, sources: [], layers: [] }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

function cleanPt(v: unknown, fallback: Pt): Pt {
	if (!Array.isArray(v) || v.length < 2) return [fallback[0], fallback[1]]
	return [clamp(num(v[0], fallback[0]), 0, 1), clamp(num(v[1], fallback[1]), 0, 1)]
}

export function rectQuad(x0 = 0.15, y0 = 0.15, x1 = 0.85, y1 = 0.85): Quad {
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
	]
}

/** A new layer: an additive one starts as a rectangle with its mask matching it; a hole starts with no mask, to be drawn. */
export function newLayer(id: string, name: string, mode: "add" | "hole", sourceId: string | null): ProjLayer {
	const corners = rectQuad()
	return {
		id,
		name,
		mode,
		sourceId,
		corners,
		mask: mode === "add" ? corners.map((p): Pt => [p[0], p[1]]) : [],
		closed: mode === "add",
		feather: 0,
	}
}

/** Anything read from a saved show or a file is untrusted: rebuild it as a valid Projection. */
export function cleanProjection(raw: unknown): Projection {
	const base = emptyProjection()
	if (!raw || typeof raw !== "object") return base
	const r = raw as Record<string, unknown>
	const width = clamp(Math.round(num(r.width, base.width)), 64, 8192)
	const height = clamp(Math.round(num(r.height, base.height)), 64, 8192)
	const seen = new Set<string>()
	const sources: ProjSource[] = []
	for (const s of Array.isArray(r.sources) ? r.sources.slice(0, MAX_SOURCES) : []) {
		if (!s || typeof s !== "object") continue
		const o = s as Record<string, unknown>
		if (typeof o.id !== "string" || !o.id || seen.has(o.id)) continue
		const kind = o.kind === "camera" ? "camera" : o.kind === "video" ? "video" : null
		if (!kind) continue
		if (kind === "video" && typeof o.path !== "string") continue
		seen.add(o.id)
		sources.push({
			id: o.id,
			kind,
			name: typeof o.name === "string" ? o.name.slice(0, 120) : kind,
			...(kind === "video" ? { path: o.path as string } : { deviceId: typeof o.deviceId === "string" ? o.deviceId : undefined }),
		})
	}
	const layerIds = new Set<string>()
	const layers: ProjLayer[] = []
	for (const l of Array.isArray(r.layers) ? r.layers.slice(0, MAX_LAYERS) : []) {
		if (!l || typeof l !== "object") continue
		const o = l as Record<string, unknown>
		if (typeof o.id !== "string" || !o.id || layerIds.has(o.id)) continue
		layerIds.add(o.id)
		const dflt = rectQuad()
		const c = Array.isArray(o.corners) ? o.corners : []
		const corners: Quad = [cleanPt(c[0], dflt[0]), cleanPt(c[1], dflt[1]), cleanPt(c[2], dflt[2]), cleanPt(c[3], dflt[3])]
		const mask = (Array.isArray(o.mask) ? o.mask.slice(0, MAX_MASK_POINTS) : []).map((p) => cleanPt(p, [0, 0]))
		layers.push({
			id: o.id,
			name: typeof o.name === "string" ? o.name.slice(0, 80) : "Layer",
			mode: o.mode === "hole" ? "hole" : "add",
			sourceId: typeof o.sourceId === "string" && seen.has(o.sourceId) ? o.sourceId : null,
			corners,
			mask,
			closed: o.closed === true && mask.length >= 3,
			feather: clamp(num(o.feather, 0), 0, MAX_FEATHER),
		})
	}
	return { width, height, sources, layers }
}

// ---------- perspective maths ----------

/** a 3x3 matrix, row-major */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** The perspective transform taking the unit square (0,0)(1,0)(1,1)(0,1) onto the quad (Heckbert's closed form). */
export function squareToQuad(q: Quad): Mat3 {
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
	const dx1 = x1 - x2
	const dx2 = x3 - x2
	const dx3 = x0 - x1 + x2 - x3
	const dy1 = y1 - y2
	const dy2 = y3 - y2
	const dy3 = y0 - y1 + y2 - y3
	if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
		// a parallelogram: no perspective needed
		return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]
	}
	const det = dx1 * dy2 - dx2 * dy1
	const g = (dx3 * dy2 - dx2 * dy3) / det
	const h = (dx1 * dy3 - dx3 * dy1) / det
	return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

export function invert3(m: Mat3): Mat3 | null {
	const [a, b, c, d, e, f, g, h, i] = m
	const A = e * i - f * h
	const B = -(d * i - f * g)
	const C = d * h - e * g
	const det = a * A + b * B + c * C
	if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
	const k = 1 / det
	return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

export function applyMat3(m: Mat3, p: Pt): Pt {
	const w = m[6] * p[0] + m[7] * p[1] + m[8]
	return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w]
}

/** True when the four corners make a proper (non-twisted, non-degenerate) convex quad; only then is the warp well defined. */
export function isConvexQuad(q: Quad): boolean {
	let sign = 0
	for (let i = 0; i < 4; i++) {
		const a = q[i]
		const b = q[(i + 1) % 4]
		const c = q[(i + 2) % 4]
		const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
		if (Math.abs(cross) < 1e-9) return false
		const s = Math.sign(cross)
		if (sign && s !== sign) return false
		sign = s
	}
	return true
}

/**
 * The matrix the shader needs for a layer: output position -> source (0..1) position. Null when the corners
 * are twisted or collapsed (the layer is then skipped rather than drawn as garbage).
 */
export function layerInverse(corners: Quad): Mat3 | null {
	if (!isConvexQuad(corners)) return null
	return invert3(squareToQuad(corners))
}

// ---------- editing helpers (pure: they return new objects) ----------

/**
 * Add a source and make sure it shows at once: onto the selected picture if that picture has no video yet,
 * otherwise onto a brand-new picture when there isn't one at all. (With other pictures already in place the
 * source is just added to the list, to be chosen where wanted.) `placed` says whether a new picture was made.
 */
export function placeSource(p: Projection, src: ProjSource, selectedId: string | null, newLayerId: string): { projection: Projection; placed: "selected" | "new" | null } {
	if (p.sources.length >= MAX_SOURCES) return { projection: p, placed: null }
	const sel = p.layers.find((l) => l.id === selectedId)
	let layers = p.layers
	let placed: "selected" | "new" | null = null
	if (sel && sel.mode === "add" && !sel.sourceId) {
		layers = layers.map((l) => (l.id === sel.id ? { ...l, sourceId: src.id } : l))
		placed = "selected"
	} else if (!p.layers.some((l) => l.mode === "add") && layers.length < MAX_LAYERS) {
		layers = [...layers, newLayer(newLayerId, "Picture 1", "add", src.id)]
		placed = "new"
	}
	return { projection: { ...p, sources: [...p.sources, src], layers }, placed }
}


export function withLayer(p: Projection, id: string, fn: (l: ProjLayer) => ProjLayer): Projection {
	if (!p.layers.some((l) => l.id === id)) return p
	return { ...p, layers: p.layers.map((l) => (l.id === id ? fn(l) : l)) }
}

export function setCorner(l: ProjLayer, i: number, pt: Pt): ProjLayer {
	if (i < 0 || i > 3) return l
	const corners = l.corners.map((c, k) => (k === i ? cleanPt(pt, c) : c)) as Quad
	return { ...l, corners }
}

export function setMaskPoint(l: ProjLayer, i: number, pt: Pt): ProjLayer {
	if (i < 0 || i >= l.mask.length) return l
	return { ...l, mask: l.mask.map((m, k) => (k === i ? cleanPt(pt, m) : m)) }
}

export function addMaskPoint(l: ProjLayer, pt: Pt): ProjLayer {
	if (l.closed || l.mask.length >= MAX_MASK_POINTS) return l
	return { ...l, mask: [...l.mask, cleanPt(pt, [0, 0])] }
}

/** insert a vertex after index `i` (on a closed shape's edge) */
export function insertMaskPoint(l: ProjLayer, i: number, pt: Pt): ProjLayer {
	if (i < 0 || i >= l.mask.length || l.mask.length >= MAX_MASK_POINTS) return l
	const mask = l.mask.slice()
	mask.splice(i + 1, 0, cleanPt(pt, [0, 0]))
	return { ...l, mask }
}

/** drop a vertex; a closed shape needs at least 3, so it stays as it is below that */
export function removeMaskPoint(l: ProjLayer, i: number): ProjLayer {
	if (i < 0 || i >= l.mask.length) return l
	if (l.closed && l.mask.length <= 3) return l
	return { ...l, mask: l.mask.filter((_, k) => k !== i) }
}

export function closeMask(l: ProjLayer): ProjLayer {
	return l.mask.length >= 3 ? { ...l, closed: true } : l
}

/** Point-in-polygon, for tests and for hit-testing. */
export function inPolygon(poly: Pt[], p: Pt): boolean {
	let inside = false
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i]
		const [xj, yj] = poly[j]
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
	}
	return inside
}
