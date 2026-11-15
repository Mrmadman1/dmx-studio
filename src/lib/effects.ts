import type { PoseFrame } from "./motion"
import type { MotionSpec } from "./profiles"
import type { Clip } from "./show"

import { clipColor } from "./show"

/**
 * Effects: recipes that write ordinary clips (or movement frames) onto the timeline.
 *
 * An effect is DATA, not code: it names one of a handful of built-in engines (chase, pulse, wash,
 * flicker, orbit) and gives that engine's settings. Every setting is checked against the engine's
 * schema and clamped, so an effect pack from anywhere can't ask for something unsafe or absurd.
 */

export type Rgb = [number, number, number]
export type Engine = "chase" | "pulse" | "wash" | "flicker" | "orbit"

// ---------- colour helpers ----------

export function hexToRgb(hex: string): Rgb | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
	if (!m) return null
	const n = Number.parseInt(m[1], 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (c: Rgb): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`

/** h in degrees, s and v 0..1 */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
	const hh = (((h % 360) + 360) % 360) / 60
	const i = Math.floor(hh)
	const f = hh - i
	const p = v * (1 - s)
	const q = v * (1 - s * f)
	const t = v * (1 - s * (1 - f))
	const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

const lerpRgb = (a: Rgb, b: Rgb, f: number): Rgb => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
const round3 = (n: number): number => Math.round(n * 1000) / 1000
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** small deterministic random numbers, so the same seed always gives the same effect */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// ---------- engine schemas: every setting an effect can have, and its limits ----------

export type Spec =
	| { type: "number"; label: string; min: number; max: number; default: number; step?: number; unit?: string; integer?: boolean }
	| { type: "choice"; label: string; options: { value: string; label: string }[]; default: string }
	| { type: "color"; label: string; default: string }
	| { type: "colors"; label: string; default: string[]; max: number }
	| { type: "toggle"; label: string; default: boolean }

const opts = (...pairs: [string, string][]): { value: string; label: string }[] => pairs.map(([value, label]) => ({ value, label }))
const intensity: Spec = { type: "number", label: "Brightness", min: 0, max: 1, default: 1, step: 0.05 }

export const ENGINES: Record<Engine, { kind: "light" | "move"; label: string; settings: Record<string, Spec> }> = {
	chase: {
		kind: "light",
		label: "Chase",
		settings: {
			step: { type: "number", label: "Time per light", min: 0.05, max: 10, default: 0.5, step: 0.05, unit: "s" },
			order: {
				type: "choice",
				label: "Direction",
				options: opts(["forward", "Forward"], ["reverse", "Reverse"], ["pingpong", "Back and forth"], ["centerOut", "Centre outwards"], ["edgesIn", "Edges inwards"], ["random", "Random"]),
				default: "forward",
			},
			colorMode: { type: "choice", label: "Colours", options: opts(["rainbow", "Rainbow"], ["palette", "My colours"]), default: "rainbow" },
			colors: { type: "colors", label: "Colours", default: ["#ff2d55", "#2d9bff"], max: 8 },
			hueStep: { type: "number", label: "Rainbow step", min: 1, max: 360, default: 30, step: 1, unit: "°" },
			trail: { type: "number", label: "Trail (steps)", min: 0, max: 6, default: 0, step: 0.5 },
			intensity,
		},
	},
	pulse: {
		kind: "light",
		label: "Pulse",
		settings: {
			timing: { type: "choice", label: "Timing", options: opts(["seconds", "Every few seconds"], ["beats", "On the beat"]), default: "seconds" },
			interval: { type: "number", label: "Every", min: 0.05, max: 20, default: 1, step: 0.05, unit: "s" },
			every: { type: "number", label: "Every N beats", min: 1, max: 16, default: 1, step: 1, integer: true },
			bpm: { type: "number", label: "Tempo if no beats", min: 40, max: 240, default: 120, step: 1, unit: "BPM" },
			pattern: {
				type: "choice",
				label: "Which lights",
				options: opts(["all", "All together"], ["evenOdd", "Alternate odd / even"], ["halves", "Alternate halves"], ["chase", "Ripple along the lights"]),
				default: "all",
			},
			stagger: { type: "number", label: "Ripple delay", min: 0, max: 2, default: 0.1, step: 0.01, unit: "s" },
			length: { type: "number", label: "Flash length", min: 0.02, max: 10, default: 0.15, step: 0.01, unit: "s" },
			attack: { type: "number", label: "Fade in", min: 0, max: 5, default: 0, step: 0.01, unit: "s" },
			decay: { type: "number", label: "Fade out", min: 0, max: 10, default: 0.2, step: 0.01, unit: "s" },
			colors: { type: "colors", label: "Colours", default: ["#ffffff"], max: 8 },
			intensity,
		},
	},
	wash: {
		kind: "light",
		label: "Colour wash",
		settings: {
			mode: {
				type: "choice",
				label: "Style",
				options: opts(["rainbow", "Rainbow cycle"], ["palette", "Cycle my colours"], ["gradient", "Fade from first to last"]),
				default: "rainbow",
			},
			cycle: { type: "number", label: "Time for one loop", min: 1, max: 120, default: 10, step: 0.5, unit: "s" },
			colors: { type: "colors", label: "Colours", default: [], max: 8 },
			offset: { type: "number", label: "Delay between lights", min: 0, max: 10, default: 0.5, step: 0.05, unit: "s" },
			saturation: { type: "number", label: "Colour strength", min: 0, max: 1, default: 1, step: 0.05 },
			intensity,
		},
	},
	flicker: {
		kind: "light",
		label: "Flicker",
		settings: {
			style: { type: "choice", label: "Colours", options: opts(["fire", "Fire"], ["palette", "My colours"]), default: "fire" },
			colors: { type: "colors", label: "Colours", default: ["#ffffff"], max: 8 },
			speed: { type: "number", label: "Changes per second", min: 0.5, max: 40, default: 8, step: 0.5 },
			depth: { type: "number", label: "How much it dips", min: 0, max: 1, default: 0.6, step: 0.05 },
			gaps: { type: "toggle", label: "Dark gaps (sparkle)", default: false },
			gapChance: { type: "number", label: "Gap chance", min: 0, max: 1, default: 0.5, step: 0.05 },
			seed: { type: "number", label: "Pattern number (0 = new each time)", min: 0, max: 99999, default: 0, step: 1, integer: true },
			intensity,
		},
	},
	orbit: {
		kind: "move",
		label: "Head pattern",
		settings: {
			shape: { type: "choice", label: "Shape", options: opts(["circle", "Circle"], ["figure8", "Figure 8"], ["sweep", "Sweep left-right"], ["nod", "Nod up-down"]), default: "circle" },
			period: { type: "number", label: "Time for one loop", min: 0.5, max: 60, default: 4, step: 0.25, unit: "s" },
			panAmp: { type: "number", label: "Pan size", min: 0, max: 270, default: 50, step: 5, unit: "°" },
			tiltAmp: { type: "number", label: "Tilt size", min: 0, max: 135, default: 35, step: 5, unit: "°" },
			centerPan: { type: "number", label: "Pan centre", min: -270, max: 270, default: 0, step: 5, unit: "°" },
			centerTilt: { type: "number", label: "Tilt centre", min: -135, max: 135, default: 0, step: 5, unit: "°" },
			spread: { type: "number", label: "Offset between heads", min: 0, max: 1, default: 0.1, step: 0.05 },
			points: { type: "number", label: "Frames per loop", min: 6, max: 32, default: 16, step: 1, integer: true },
		},
	},
}

export type Settings = Record<string, number | string | boolean | string[]>

/** Fill in a full, safe settings object for an engine: unknown keys dropped, numbers clamped, colours and choices checked. */
export function normalizeSettings(engine: Engine, raw: Record<string, unknown>): Settings {
	const out: Settings = {}
	for (const [key, spec] of Object.entries(ENGINES[engine].settings)) {
		const v = raw[key]
		if (spec.type === "number") {
			let n = typeof v === "number" && Number.isFinite(v) ? v : spec.default
			n = clamp(n, spec.min, spec.max)
			out[key] = spec.integer ? Math.round(n) : n
		} else if (spec.type === "choice") {
			out[key] = typeof v === "string" && spec.options.some((o) => o.value === v) ? v : spec.default
		} else if (spec.type === "color") {
			out[key] = typeof v === "string" && hexToRgb(v) ? rgbToHex(hexToRgb(v) as Rgb) : spec.default
		} else if (spec.type === "colors") {
			out[key] = Array.isArray(v)
				? v.filter((c): c is string => typeof c === "string" && !!hexToRgb(c)).slice(0, spec.max).map((c) => rgbToHex(hexToRgb(c) as Rgb))
				: spec.default
		} else {
			out[key] = typeof v === "boolean" ? v : spec.default
		}
	}
	return out
}

// ---------- the effect definition (what a pack contains) ----------

export interface EffectDef {
	id: string
	name: string
	category: string
	description: string
	engine: Engine
	/** the engine's settings with this effect's own defaults */
	settings: Settings
	/** which settings the user can adjust before applying */
	expose: string[]
	/** how many seconds it covers by default */
	length: number
}

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) || fallback : fallback)

/** Check one effect from outside (a pack file, a saved show). null if it isn't usable. */
export function normalizeEffect(raw: unknown): EffectDef | null {
	if (!raw || typeof raw !== "object") return null
	const r = raw as Record<string, unknown>
	if (typeof r.engine !== "string" || !Object.hasOwn(ENGINES, r.engine)) return null // (not `in`: that would accept "__proto__" or "toString")
	const engine = r.engine as Engine
	const id = str(r.id, 64).toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
	const name = str(r.name, 60)
	if (!id || !name) return null
	const schema = ENGINES[engine].settings
	const expose = Array.isArray(r.expose) ? r.expose.filter((k): k is string => typeof k === "string" && Object.hasOwn(schema, k)) : Object.keys(schema)
	return {
		id,
		name,
		category: str(r.category, 30, "Imported"),
		description: str(r.description, 200),
		engine,
		settings: normalizeSettings(engine, r.settings && typeof r.settings === "object" ? (r.settings as Record<string, unknown>) : {}),
		expose: [...new Set(expose)],
		length: clamp(typeof r.length === "number" && Number.isFinite(r.length) ? r.length : 8, 0.5, 600),
	}
}

export const PACK_FORMAT = "dmx-studio-effects"

/** Read an effect pack file: { format, version, effects: [...] }. Bad entries are skipped and reported. */
export function parsePack(text: string): { effects: EffectDef[]; problems: string[] } {
	let data: unknown
	try {
		data = JSON.parse(text)
	} catch {
		return { effects: [], problems: ["That file isn't valid JSON."] }
	}
	const list = Array.isArray(data) ? data : (data as { effects?: unknown })?.effects
	if (!Array.isArray(list)) return { effects: [], problems: ["No effects found in that file."] }
	const effects: EffectDef[] = []
	const problems: string[] = []
	list.slice(0, 200).forEach((raw, i) => {
		const e = normalizeEffect(raw)
		if (e) effects.push(e)
		else problems.push(`Effect #${i + 1} was skipped (missing name, id or a known engine).`)
	})
	if (list.length > 200) problems.push("Only the first 200 effects were read.")
	return { effects, problems }
}

export function packToJson(effects: EffectDef[]): string {
	return JSON.stringify({ format: PACK_FORMAT, version: 1, effects }, null, 2)
}

// ---------- generating ----------

export type ClipDraft = Omit<Clip, "id" | "source">
export type FrameDraft = Omit<PoseFrame, "id" | "source">

export interface FxContext {
	/** where the effect begins on the timeline, and how long it runs */
	start: number
	length: number
	/** the lights it will play on, in track order */
	fixtures: { id: string; spec?: MotionSpec }[]
	/** beat times (timeline seconds) inside the range, for beat-synced effects */
	beats: number[]
	/** tempo to fall back on when there are no detected beats */
	bpm: number
	seed: number
}

export type FxResult = { ok: true; clips: ClipDraft[]; frames: FrameDraft[] } | { ok: false; error: string }
export const MAX_ITEMS = 4000
const MIN_CLIP = 0.02

function draft(fixtureId: string, start: number, duration: number, from: Rgb, to: Rgb | null, intensity: number, fadeIn: number, fadeOut: number): ClipDraft {
	// round the START and the END, and take the length from those: rounding start and length separately could
	// leave neighbouring clips overlapping by a millisecond, which the rest of the app counts as a collision
	const s0 = round3(start)
	const dur = round3(round3(start + duration) - s0)
	const fi = clamp(fadeIn, 0, dur)
	return {
		fixtureId,
		start: s0,
		duration: dur,
		r: Math.round(from[0]),
		g: Math.round(from[1]),
		b: Math.round(from[2]),
		...(to ? { to: [Math.round(to[0]), Math.round(to[1]), Math.round(to[2])] as Rgb } : {}),
		intensity,
		fadeIn: round3(fi),
		fadeOut: round3(clamp(fadeOut, 0, dur - fi)),
		curve: "smooth",
	}
}

const paletteOf = (s: Settings, fallback: string[]): Rgb[] => {
	const list = ((s.colors as string[]) ?? []).map((c) => hexToRgb(c)).filter((c): c is Rgb => !!c)
	return list.length ? list : fallback.map((c) => hexToRgb(c) as Rgb)
}

/** order in which the lights are visited */
function sequence(n: number, order: string): number[] {
	const fwd = Array.from({ length: n }, (_, i) => i)
	if (order === "reverse") return fwd.reverse()
	if (order === "pingpong") return n > 1 ? [...fwd, ...fwd.slice(1, -1).reverse()] : fwd
	if (order === "centerOut" || order === "edgesIn") {
		const mid = (n - 1) / 2
		const out = [...fwd].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
		return order === "edgesIn" ? out.reverse() : out
	}
	return fwd
}

function chase(s: Settings, ctx: FxContext, rng: () => number): ClipDraft[] {
	const n = ctx.fixtures.length
	const step = s.step as number
	const trail = s.trail as number
	const end = ctx.start + ctx.length
	const steps = Math.max(1, Math.ceil(ctx.length / step - 1e-9))
	const seq = sequence(n, s.order as string)
	const palette = paletteOf(s, ["#ffffff"])
	const visits: { fi: number; k: number; start: number }[] = []
	let prev = -1
	for (let k = 0; k < steps; k++) {
		let fi: number
		if (s.order === "random") {
			do fi = Math.floor(rng() * n)
			while (n > 1 && fi === prev)
		} else fi = seq[k % seq.length]
		prev = fi
		visits.push({ fi, k, start: ctx.start + k * step })
	}
	const out: ClipDraft[] = []
	visits.forEach((v, idx) => {
		// a light's next visit is where this clip must stop
		let next = Number.POSITIVE_INFINITY
		for (let j = idx + 1; j < visits.length; j++) {
			if (visits[j].fi === v.fi) {
				next = visits[j].start
				break
			}
		}
		const length = Math.min(step * (1 + trail), next - v.start, end - v.start)
		if (length < MIN_CLIP) return
		const color = s.colorMode === "rainbow" ? hsvToRgb(v.k * (s.hueStep as number), 1, 1) : palette[v.k % palette.length]
		const fadeIn = Math.min(0.05, length * 0.2)
		const fadeOut = trail > 0 ? Math.min(step * trail, length - fadeIn) : Math.min(length * 0.3, length - fadeIn)
		out.push(draft(ctx.fixtures[v.fi].id, v.start, length, color, null, s.intensity as number, fadeIn, fadeOut))
	})
	return out
}

function pulse(s: Settings, ctx: FxContext): ClipDraft[] {
	const n = ctx.fixtures.length
	const end = ctx.start + ctx.length
	let times: number[]
	if (s.timing === "beats" && ctx.beats.length) {
		times = ctx.beats.filter((b) => b >= ctx.start - 1e-9 && b < end - 1e-9).filter((_, i) => i % (s.every as number) === 0)
	} else {
		const gap = s.timing === "beats" ? (60 / (ctx.bpm || (s.bpm as number))) * (s.every as number) : (s.interval as number)
		times = []
		for (let t = ctx.start; t < end - 1e-9; t += gap) times.push(t)
	}
	const palette = paletteOf(s, ["#ffffff"])
	// each light's own list of pulses
	const per: { start: number; color: Rgb }[][] = Array.from({ length: n }, () => [])
	times.forEach((t, k) => {
		for (let i = 0; i < n; i++) {
			let hit = true
			let delay = 0
			if (s.pattern === "evenOdd") hit = i % 2 === k % 2
			else if (s.pattern === "halves") hit = i < n / 2 === (k % 2 === 0)
			else if (s.pattern === "chase") delay = i * (s.stagger as number)
			if (hit) per[i].push({ start: t + delay, color: palette[k % palette.length] })
		}
	})
	const out: ClipDraft[] = []
	per.forEach((list, i) => {
		list.forEach((p, j) => {
			const next = list[j + 1]?.start ?? Number.POSITIVE_INFINITY
			const length = Math.min(s.length as number, next - p.start, end - p.start)
			if (length < MIN_CLIP) return
			const fadeIn = Math.min(s.attack as number, length)
			out.push(draft(ctx.fixtures[i].id, p.start, length, p.color, null, s.intensity as number, fadeIn, Math.min(s.decay as number, length - fadeIn)))
		})
	})
	return out
}

function wash(s: Settings, ctx: FxContext): ClipDraft[] {
	const n = ctx.fixtures.length
	const t0 = ctx.start
	const t1 = ctx.start + ctx.length
	const sat = s.saturation as number
	const mode = s.mode as string
	const out: ClipDraft[] = []

	// the colour stops: a closed loop for rainbow/palette, an open run for a one-way gradient
	let stops: Rgb[]
	if (mode === "rainbow") stops = Array.from({ length: 12 }, (_, j) => hsvToRgb(j * 30, sat, 1))
	else if (mode === "gradient") {
		stops = paletteOf(s, ["#ffb347", "#ff5e62", "#8e2de2", "#1a0f3c"])
		if (stops.length < 2) stops = [stops[0], stops[0]]
	} else stops = paletteOf(s, ["#ff2d55", "#2d9bff"])
	const m = stops.length

	for (let i = 0; i < n; i++) {
		const d = i * (s.offset as number)
		const id = ctx.fixtures[i].id
		let colorAt: (t: number) => Rgb
		const cuts: number[] = []
		if (mode === "gradient") {
			// one pass from the first colour to the last; later lights start a little later but all get there
			const L = Math.max(0.5, ctx.length - (n - 1) * (s.offset as number))
			colorAt = (t) => {
				const p = clamp((t - t0 - d) / L, 0, 1) * (m - 1)
				const k = Math.min(m - 2, Math.floor(p))
				return lerpRgb(stops[k], stops[k + 1], p - k)
			}
			for (let k = 0; k < m; k++) cuts.push(t0 + d + (k / (m - 1)) * L)
		} else {
			const cycle = s.cycle as number
			const seg = cycle / m
			colorAt = (t) => {
				const u = ((((t - t0 - d) / cycle) % 1) + 1) % 1
				const p = u * m
				const k = Math.floor(p) % m
				return lerpRgb(stops[k], stops[(k + 1) % m], p - Math.floor(p))
			}
			for (let t = t0 + d + Math.ceil(-d / seg + 1e-9) * seg; t < t1 - 1e-9; t += seg) cuts.push(t)
		}
		const points = [...new Set([t0, t1, ...cuts.filter((t) => t > t0 + 1e-9 && t < t1 - 1e-9)].map(round3))].sort((a, b) => a - b)
		for (let k = 0; k + 1 < points.length; k++) {
			const a = points[k]
			const b = points[k + 1]
			if (b - a < MIN_CLIP) continue
			out.push(draft(id, a, b - a, colorAt(a), colorAt(b), s.intensity as number, 0, 0))
		}
	}
	return out
}

function flicker(s: Settings, ctx: FxContext, rng: () => number): ClipDraft[] {
	const out: ClipDraft[] = []
	const end = ctx.start + ctx.length
	const palette = paletteOf(s, ["#ffffff"])
	for (const f of ctx.fixtures) {
		let t = ctx.start
		while (t < end - MIN_CLIP) {
			const seg = Math.min((1 / (s.speed as number)) * (0.5 + rng()), end - t)
			if (seg < MIN_CLIP) break
			if (s.gaps && rng() < (s.gapChance as number)) {
				t += seg // dark for a moment
				continue
			}
			const color = s.style === "fire" ? hsvToRgb(8 + rng() * 32, 0.85 + rng() * 0.15, 1) : palette[Math.floor(rng() * palette.length)]
			const level = (s.intensity as number) * (1 - (s.depth as number) * rng())
			out.push(draft(f.id, t, seg, color, null, level, seg * 0.2, seg * 0.2))
			t += seg
		}
	}
	return out
}

function orbit(s: Settings, ctx: FxContext): FrameDraft[] {
	const out: FrameDraft[] = []
	const period = s.period as number
	const points = s.points as number
	const dt = period / points
	const count = Math.floor(ctx.length / dt + 1e-9)
	ctx.fixtures.forEach((f, j) => {
		const spec = f.spec
		for (let k = 0; k <= count; k++) {
			const phase = 2 * Math.PI * (k / points + j * (s.spread as number))
			let pan = 0
			let tilt = 0
			if (s.shape === "circle") [pan, tilt] = [Math.cos(phase), Math.sin(phase)]
			else if (s.shape === "figure8") [pan, tilt] = [Math.sin(phase), Math.sin(2 * phase) / 2]
			else if (s.shape === "sweep") [pan, tilt] = [Math.sin(phase), 0]
			else [pan, tilt] = [0, Math.sin(phase)]
			let p = (s.centerPan as number) + pan * (s.panAmp as number)
			let t = (s.centerTilt as number) + tilt * (s.tiltAmp as number)
			if (spec) {
				p = clamp(p, -spec.panRange / 2, spec.panRange / 2)
				t = clamp(t, -spec.tiltRange / 2, spec.tiltRange / 2)
			}
			// straight lines between frames: a sine sampled this way stays smooth, and easing would make the head stop at every frame
			out.push({ fixtureId: f.id, start: round3(ctx.start + k * dt), pan: Math.round(p * 10) / 10, tilt: Math.round(t * 10) / 10, ease: "linear" })
		}
	})
	return out
}

/** Turn an effect into clips (or frames) for a given range and set of lights. Pure: nothing is written to the show. */
export function generateEffect(def: EffectDef, values: Record<string, unknown>, ctx: FxContext): FxResult {
	if (ctx.fixtures.length === 0) return { ok: false, error: "There are no lights for this effect to play on." }
	if (!(ctx.length > 0)) return { ok: false, error: "The effect needs a length greater than zero." }
	const s = normalizeSettings(def.engine, { ...def.settings, ...values })
	// a fixed pattern number (flicker effects) always gives the same result; 0 means "use this run's own seed"
	const rng = mulberry32(typeof s.seed === "number" && s.seed > 0 ? s.seed : ctx.seed)
	let clips: ClipDraft[] = []
	let frames: FrameDraft[] = []
	switch (def.engine) {
		case "chase":
			clips = chase(s, ctx, rng)
			break
		case "pulse":
			clips = pulse(s, ctx)
			break
		case "wash":
			clips = wash(s, ctx)
			break
		case "flicker":
			clips = flicker(s, ctx, rng)
			break
		case "orbit":
			frames = orbit(s, ctx)
			break
	}
	const total = clips.length + frames.length
	if (total > MAX_ITEMS) return { ok: false, error: `That would make ${total} clips. Shorten it, slow it down, or use fewer lights (the limit is ${MAX_ITEMS}).` }
	return { ok: true, clips, frames }
}

// ---------- the built-in library ----------

type Preset = Omit<EffectDef, "settings" | "expose"> & { settings: Record<string, unknown>; expose: string[] }

const PRESETS: Preset[] = [
	{ id: "rainbow-chase", name: "Rainbow Chase", category: "Chases", engine: "chase", length: 10, description: "One light after another, shifting round the colour wheel.", settings: { step: 0.4, order: "forward", colorMode: "rainbow", hueStep: 40, trail: 1 }, expose: ["step", "order", "hueStep", "trail", "intensity"] },
	{ id: "color-chase", name: "Colour Chase", category: "Chases", engine: "chase", length: 10, description: "A chase through colours you choose.", settings: { step: 0.5, colorMode: "palette", colors: ["#ff2d55", "#2d9bff"], trail: 0 }, expose: ["step", "order", "colors", "trail", "intensity"] },
	{ id: "knight-rider", name: "Scanner", category: "Chases", engine: "chase", length: 8, description: "A light sweeping back and forth with a glowing trail.", settings: { step: 0.12, order: "pingpong", colorMode: "palette", colors: ["#ff1a1a"], trail: 2.5 }, expose: ["step", "colors", "trail", "intensity"] },
	{ id: "bass-pulse", name: "Bass Pulse", category: "Pulses", engine: "pulse", length: 16, description: "Every light hits on each beat of your song, then fades. Detect the beats in the Audio tab first for a tight lock.", settings: { timing: "beats", every: 1, pattern: "all", length: 0.4, attack: 0, decay: 0.3, colors: ["#ffffff"] }, expose: ["timing", "every", "bpm", "colors", "decay", "intensity"] },
	{ id: "police-strobe", name: "Police Strobe", category: "Pulses", engine: "pulse", length: 6, description: "Red and blue flashing in turn.", settings: { timing: "seconds", interval: 0.14, pattern: "halves", length: 0.1, attack: 0, decay: 0, colors: ["#ff0000", "#0040ff"] }, expose: ["interval", "colors", "intensity"] },
	{ id: "strobe", name: "Strobe", category: "Pulses", engine: "pulse", length: 4, description: "Rapid white flashes. Not for anyone sensitive to flashing light.", settings: { timing: "seconds", interval: 0.08, pattern: "all", length: 0.04, attack: 0, decay: 0, colors: ["#ffffff"] }, expose: ["interval", "length", "colors", "intensity"] },
	{ id: "breathe", name: "Breathe", category: "Pulses", engine: "pulse", length: 12, description: "A slow swell up and down, like breathing.", settings: { timing: "seconds", interval: 3, pattern: "all", length: 3, attack: 1.4, decay: 1.4, colors: ["#4da3ff"] }, expose: ["interval", "colors", "intensity"] },
	{ id: "alternate", name: "Alternate", category: "Pulses", engine: "pulse", length: 12, description: "Odd and even lights trade places in two colours.", settings: { timing: "seconds", interval: 1, pattern: "evenOdd", length: 0.9, attack: 0.1, decay: 0.3, colors: ["#ff9500", "#af52de"] }, expose: ["interval", "colors", "intensity"] },
	{ id: "sunset-fade", name: "Sunset Fade", category: "Washes", engine: "wash", length: 20, description: "A slow fade from gold to deep purple, rippling across the lights.", settings: { mode: "gradient", colors: ["#ffb347", "#ff5e62", "#8e2de2", "#1a0f3c"], offset: 0.6 }, expose: ["colors", "offset", "intensity"] },
	{ id: "rainbow-wash", name: "Rainbow Wash", category: "Washes", engine: "wash", length: 16, description: "Every light glides through the rainbow, a little behind its neighbour.", settings: { mode: "rainbow", cycle: 8, offset: 0.5 }, expose: ["cycle", "offset", "saturation", "intensity"] },
	{ id: "fire", name: "Fire", category: "Texture", engine: "flicker", length: 15, description: "Warm, flickering firelight.", settings: { style: "fire", speed: 9, depth: 0.55, gaps: false }, expose: ["speed", "depth", "intensity"] },
	{ id: "sparkle", name: "Sparkle", category: "Texture", engine: "flicker", length: 12, description: "Random twinkles of pale colour.", settings: { style: "palette", colors: ["#ffffff", "#ffe9a8", "#a8d8ff"], speed: 6, depth: 0.3, gaps: true, gapChance: 0.6 }, expose: ["colors", "speed", "gapChance", "intensity"] },
	{ id: "head-circle", name: "Circle", category: "Moving heads", engine: "orbit", length: 16, description: "Moving heads trace circles. Fast loops will show the head's motors lagging.", settings: { shape: "circle", period: 4, panAmp: 50, tiltAmp: 35, spread: 0.12 }, expose: ["period", "panAmp", "tiltAmp", "centerPan", "centerTilt", "spread"] },
	{ id: "head-figure8", name: "Figure 8", category: "Moving heads", engine: "orbit", length: 20, description: "Moving heads draw a figure of eight.", settings: { shape: "figure8", period: 5, panAmp: 60, tiltAmp: 40, spread: 0.1 }, expose: ["period", "panAmp", "tiltAmp", "centerPan", "centerTilt", "spread"] },
	{ id: "head-sweep", name: "Sweep", category: "Moving heads", engine: "orbit", length: 18, description: "Moving heads swing left and right.", settings: { shape: "sweep", period: 6, panAmp: 90, tiltAmp: 0, spread: 0.1 }, expose: ["period", "panAmp", "centerPan", "centerTilt", "spread"] },
	{ id: "head-nod", name: "Nod", category: "Moving heads", engine: "orbit", length: 10, description: "Moving heads nod up and down.", settings: { shape: "nod", period: 2, panAmp: 0, tiltAmp: 40, spread: 0.15 }, expose: ["period", "tiltAmp", "centerPan", "centerTilt", "spread"] },
]

export const BUILTIN_EFFECTS: EffectDef[] = PRESETS.map((p) => normalizeEffect(p) as EffectDef)

// ---------- placing an effect on the timeline ----------

/** Beat times of an audio clip as timeline seconds (beats are stored against the file, so a trimmed clip shifts them). */
export function audioBeatTimes(a: { start: number; duration: number; offset?: number; beats?: number[] }): number[] {
	const off = a.offset ?? 0
	return (a.beats ?? [])
		.map((b) => a.start + b - off)
		.filter((t) => t >= a.start - 1e-9 && t <= a.start + a.duration + 1e-9)
		.sort((x, y) => x - y)
}

const hits = (c: Clip, ids: Set<string>, a: number, b: number): boolean => ids.has(c.fixtureId) && c.start < b - 1e-6 && c.start + c.duration > a + 1e-6

/** How many existing clips on these lights an effect over [a, b] would cut into. */
export const countClipsInRange = (clips: Clip[], ids: Set<string>, a: number, b: number): number => clips.filter((c) => hits(c, ids, a, b)).length

/**
 * Clear the range [a, b] on some lights to make room for an effect: clips inside it are removed, clips
 * poking in from either side are trimmed back to the edge (a gradient keeps the colour it had there),
 * and a clip spanning the whole range is split in two around it.
 */
export function carveClips(clips: Clip[], ids: Set<string>, a: number, b: number, nextId: () => string): Clip[] {
	const out: Clip[] = []
	for (const c of clips) {
		if (!hits(c, ids, a, b)) {
			out.push(c)
			continue
		}
		const end = c.start + c.duration
		const mid = (t: number): Rgb => clipColor(c, t).map(Math.round) as Rgb
		if (c.start < a - 1e-6) {
			const duration = a - c.start
			const fadeIn = Math.min(c.fadeIn, duration)
			if (duration >= MIN_CLIP) out.push({ ...c, duration, fadeIn, fadeOut: 0, ...(c.to ? { to: mid(a) } : {}) })
		}
		if (end > b + 1e-6) {
			const duration = end - b
			const [r, g, bl] = c.to ? mid(b) : [c.r, c.g, c.b]
			// the piece after the range is new if the clip was split around it, otherwise it is the same clip, trimmed
			const keepsId = c.start >= a - 1e-6
			if (duration >= MIN_CLIP) out.push({ ...c, id: keepsId ? c.id : nextId(), start: b, duration, r, g, b: bl, fadeIn: 0, fadeOut: Math.min(c.fadeOut, duration) })
		}
	}
	return out
}
