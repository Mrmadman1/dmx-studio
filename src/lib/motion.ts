import type { Fixture } from "./store"

import { type MotionSpec, profileById } from "./profiles"

/**
 * Moving-head motion.
 *
 * A moving head has two motors, pan (turn left/right) and tilt (nod up/down), and each has limits: how
 * far it can turn, how fast, and how quickly it can speed up and slow down. You can't tell a real head
 * to be somewhere "now"; you tell it where to go and it gets there as fast as the motors allow.
 *
 * Frames say where the head SHOULD be and when. `simulateMotion` plays those frames through the motor
 * limits to work out where the head ACTUALLY is at every moment. That is what the 3D view shows, what
 * gets sent over DMX, and what the warnings ("arrives 0.4 s late") are measured against.
 *
 * Angles are degrees, 0 = centred (for a hung head: pointing straight down). Positive pan turns
 * counter-clockwise seen from above; positive tilt swings the beam toward -z (the back of the stage).
 */

export type Ease = "smooth" | "linear" | "hold"

/** A pose at a moment: where the head should be at `start` seconds. (`start`, like clips, so frames move with the generic item code.) */
export interface PoseFrame {
	id: string
	fixtureId: string
	start: number
	pan: number
	tilt: number
	/** how the head travels INTO this frame from the one before it */
	ease: Ease
}

export interface Pose {
	pan: number
	tilt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const pos = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback)

/** A fixture's motor limits: its profile's defaults, with any the user has tuned to match their real head. null for lights that don't move. */
export function motionOf(f: Pick<Fixture, "profileId" | "motion">): MotionSpec | null {
	const base = profileById(f.profileId).motion
	if (!base) return null
	const o = f.motion ?? {}
	return {
		panRange: pos(o.panRange, base.panRange),
		tiltRange: pos(o.tiltRange, base.tiltRange),
		panSpeed: pos(o.panSpeed, base.panSpeed),
		tiltSpeed: pos(o.tiltSpeed, base.tiltSpeed),
		accel: pos(o.accel, base.accel),
	}
}

/** Keep only usable overrides from saved data. */
export function cleanMotion(o: unknown): Partial<MotionSpec> | undefined {
	if (!o || typeof o !== "object") return undefined
	const out: Partial<MotionSpec> = {}
	for (const k of ["panRange", "tiltRange", "panSpeed", "tiltSpeed", "accel"] as const) {
		const v = (o as Record<string, unknown>)[k]
		if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v
	}
	return Object.keys(out).length ? out : undefined
}

/** Rebuild saved frames defensively: drop junk, clamp numbers. */
export function validFrames(list: unknown): PoseFrame[] {
	if (!Array.isArray(list)) return []
	return list.flatMap((raw: unknown): PoseFrame[] => {
		if (!raw || typeof raw !== "object") return []
		const f = raw as Partial<PoseFrame>
		if (typeof f.id !== "string" || typeof f.fixtureId !== "string" || typeof f.start !== "number" || !Number.isFinite(f.start)) return []
		const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
		return [
			{
				id: f.id,
				fixtureId: f.fixtureId,
				start: Math.max(0, f.start),
				pan: n(f.pan),
				tilt: n(f.tilt),
				ease: f.ease === "linear" || f.ease === "hold" ? f.ease : "smooth",
			},
		]
	})
}

// ---------- DMX ----------

/** Pan/tilt are 16-bit: a coarse byte and a fine byte. Centre (0°) is 128 / 0. */
export function angleToDmx(angle: number, range: number): [number, number] {
	const v = Math.round(clamp(angle / range + 0.5, 0, 1) * 65535)
	return [v >> 8, v & 255]
}

export function dmxToAngle(coarse: number, fine: number, range: number): number {
	return ((coarse * 256 + fine) / 65535 - 0.5) * range
}

/** Where a head points according to its pan/tilt faders (used when no frames drive it). */
export function manualPose(f: Fixture, spec: MotionSpec): Pose {
	const ch = profileById(f.profileId).channels
	const val = (kind: string): number => {
		const i = ch.findIndex((c) => c.kind === kind)
		return i < 0 ? 0 : f.values[i]
	}
	return {
		pan: dmxToAngle(val("pan"), val("panFine"), spec.panRange),
		tilt: dmxToAngle(val("tilt"), val("tiltFine"), spec.tiltRange),
	}
}

/** A copy of a fixture's channel values with its pan/tilt channels set to point at `pose`. */
export function applyPose(values: number[], profileId: string, pose: Pose, spec: MotionSpec): number[] {
	const out = values.slice()
	const [pc, pf] = angleToDmx(pose.pan, spec.panRange)
	const [tc, tf] = angleToDmx(pose.tilt, spec.tiltRange)
	profileById(profileId).channels.forEach((c, i) => {
		if (c.kind === "pan") out[i] = pc
		else if (c.kind === "panFine") out[i] = pf
		else if (c.kind === "tilt") out[i] = tc
		else if (c.kind === "tiltFine") out[i] = tf
	})
	return out
}

// ---------- where the frames say the head should be ----------

const ease = (u: number, kind: Ease): number => {
	const c = clamp(u, 0, 1)
	if (kind === "linear") return c
	if (kind === "hold") return c >= 1 ? 1 : 0
	return c * c * (3 - 2 * c)
}

export const byTime = (a: PoseFrame, b: PoseFrame): number => a.start - b.start

/** The pose the frames ask for at time t (before the first frame and after the last, it holds that frame). `frames` must be one head's, sorted by time. */
export function commandedPose(frames: PoseFrame[], t: number, fallback: Pose = { pan: 0, tilt: 0 }): Pose {
	if (frames.length === 0) return fallback
	if (t <= frames[0].start) return { pan: frames[0].pan, tilt: frames[0].tilt }
	const last = frames[frames.length - 1]
	if (t >= last.start) return { pan: last.pan, tilt: last.tilt }
	let i = 0
	while (i + 2 < frames.length && frames[i + 1].start <= t) i++
	const a = frames[i]
	const b = frames[i + 1]
	const e = ease((t - a.start) / Math.max(1e-6, b.start - a.start), b.ease)
	return { pan: a.pan + (b.pan - a.pan) * e, tilt: a.tilt + (b.tilt - a.tilt) * e }
}

// ---------- where the head actually is: the motors ----------

export interface Simulation {
	/** seconds between samples */
	dt: number
	pan: Float32Array
	tilt: Float32Array
}

const STEP = 0.01 // 100 samples a second
const LAG = 0.03 // seconds the motor takes to respond to a change of speed (its 0.02 s response + one step)

/**
 * Run the frames through the motors. Each motor chases the commanded angle: it leads with the
 * commanded velocity, closes the gap along a braking curve (so it stops ON the target instead of
 * overshooting), and is never allowed to exceed its top speed or acceleration or leave its range.
 * The head starts parked on the first frame.
 */
export function simulateMotion(frames: PoseFrame[], spec: MotionSpec, endTime: number): Simulation | null {
	if (frames.length === 0) return null
	const dt = STEP
	const n = Math.max(2, Math.ceil(endTime / dt) + 1)
	const pan = new Float32Array(n)
	const tilt = new Float32Array(n)
	const axis = (get: (p: Pose) => number, out: Float32Array, range: number, vmax: number): void => {
		const half = range / 2
		let x = clamp(get(commandedPose(frames, 0)), -half, half)
		let v = 0
		for (let i = 0; i < n; i++) {
			out[i] = x
			const t = i * dt
			const c0 = clamp(get(commandedPose(frames, t)), -half, half)
			const c1 = clamp(get(commandedPose(frames, t + dt)), -half, half)
			const gap = c0 - x
			// follow the commanded motion, plus close any gap along the braking curve sqrt(2*a*d). The motor
			// keeps coasting for a moment before a change of speed takes effect, so brake for the distance
			// that is left AFTER that coast, or it would overshoot the target.
			const lead = (c1 - c0) / dt
			const left = Math.max(0, Math.abs(gap) - Math.abs(v) * LAG)
			const close = Math.sign(gap) * Math.min(Math.sqrt(2 * spec.accel * left), 25 * Math.abs(gap))
			const want = clamp(lead + close, -vmax, vmax)
			const a = clamp((want - v) / 0.02, -spec.accel, spec.accel)
			v = clamp(v + a * dt, -vmax, vmax)
			x += v * dt
			if (x > half || x < -half) {
				x = clamp(x, -half, half)
				v = 0
			}
		}
	}
	axis((p) => p.pan, pan, spec.panRange, spec.panSpeed)
	axis((p) => p.tilt, tilt, spec.tiltRange, spec.tiltSpeed)
	return { dt, pan, tilt }
}

export function samplePose(sim: Simulation, t: number): Pose {
	const x = clamp(t / sim.dt, 0, sim.pan.length - 1)
	const i = Math.floor(x)
	const j = Math.min(i + 1, sim.pan.length - 1)
	const f = x - i
	return { pan: sim.pan[i] + (sim.pan[j] - sim.pan[i]) * f, tilt: sim.tilt[i] + (sim.tilt[j] - sim.tilt[i]) * f }
}

/** Whether the head makes it to a frame's pose in time. */
export interface Arrival {
	/** seconds after the frame's time that the head gets within a degree of its pose (0 = on time) */
	late: number
	/** false if the next frame arrives (or the show ends) before the head gets there */
	reached: boolean
}

/** For each frame, whether the (simulated) head gets there on time. `frames` sorted, one head's. */
export function arrivals(frames: PoseFrame[], sim: Simulation, tolerance = 1): Map<string, Arrival> {
	const out = new Map<string, Arrival>()
	frames.forEach((fr, k) => {
		if (k === 0) {
			out.set(fr.id, { late: 0, reached: true }) // parked here before the show starts
			return
		}
		const next = frames[k + 1]
		const from = Math.max(0, Math.floor(fr.start / sim.dt))
		const to = next ? Math.min(sim.pan.length - 1, Math.ceil(next.start / sim.dt)) : sim.pan.length - 1
		let hit = -1
		for (let j = from; j <= to; j++) {
			if (Math.abs(sim.pan[j] - fr.pan) <= tolerance && Math.abs(sim.tilt[j] - fr.tilt) <= tolerance) {
				hit = j
				break
			}
		}
		out.set(fr.id, hit < 0 ? { late: Number.POSITIVE_INFINITY, reached: false } : { late: Math.max(0, hit * sim.dt - fr.start), reached: true })
	})
	return out
}

// ---------- cache: one simulation per head, rebuilt only when its frames or limits change ----------

interface Entry {
	framesRef: PoseFrame[]
	sig: string
	mine: PoseFrame[]
	sim: Simulation
	arrivals?: Map<string, Arrival>
}
const cache = new Map<string, Entry>()

function entryFor(f: Fixture, spec: MotionSpec, all: PoseFrame[]): Entry | null {
	const key = `${f.id}|${spec.panRange}|${spec.tiltRange}|${spec.panSpeed}|${spec.tiltSpeed}|${spec.accel}`
	const hit = cache.get(key)
	if (hit && hit.framesRef === all) return hit
	const mine = all.filter((fr) => fr.fixtureId === f.id).sort(byTime)
	if (mine.length === 0) {
		cache.delete(key)
		return null
	}
	const sig = mine.map((fr) => `${fr.id}:${fr.start}:${fr.pan}:${fr.tilt}:${fr.ease}`).join(";")
	if (hit && hit.sig === sig) {
		hit.framesRef = all // some other head's frames changed: ours didn't
		return hit
	}
	const end = mine[mine.length - 1].start + 20 // room for the last move to finish
	const sim = simulateMotion(mine, spec, end)
	if (!sim) return null
	const entry: Entry = { framesRef: all, sig, mine, sim }
	cache.set(key, entry)
	return entry
}

/** Where a head's motors really are at time t, given all the show's frames. null if it has no frames (then its faders decide). */
export function poseAt(f: Fixture, all: PoseFrame[], t: number): Pose | null {
	const spec = motionOf(f)
	if (!spec) return null
	const e = entryFor(f, spec, all)
	return e ? samplePose(e.sim, t) : null
}

/** For each of a head's frames: does the head get there on time? Empty if it has none. */
export function motionReport(f: Fixture, all: PoseFrame[]): Map<string, Arrival> {
	const spec = motionOf(f)
	const e = spec ? entryFor(f, spec, all) : null
	if (!e) return new Map()
	return (e.arrivals ??= arrivals(e.mine, e.sim))
}

/** The pose a head would be told to take: from its pose at time t if it has frames, else from its faders. null for lights that don't move. */
export function currentPose(f: Fixture, all: PoseFrame[], t: number): Pose | null {
	const spec = motionOf(f)
	if (!spec) return null
	return poseAt(f, all, t) ?? manualPose(f, spec)
}
