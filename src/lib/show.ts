import type { Fixture } from "./store"

import { type Pose, applyPose, motionOf } from "./motion"
import { profileById } from "./profiles"

export type Curve = "linear" | "smooth"

/** A block on a fixture's track: while the playhead is inside it, it drives the light. */
export interface Clip {
	id: string
	fixtureId: string
	/** seconds from the start of the show */
	start: number
	duration: number
	r: number
	g: number
	b: number
	/** 0..1 peak brightness */
	intensity: number
	/** seconds to ramp up from black at the start / down to black at the end */
	fadeIn: number
	fadeOut: number
	curve: Curve
	/** set on clips generated from an audio clip's beats, so they can be cleared together */
	source?: string
}

export const MIN_CLIP = 0.1

const ease = (x: number, curve: Curve): number => {
	const c = Math.min(1, Math.max(0, x))
	return curve === "smooth" ? c * c * (3 - 2 * c) : c
}

/** 0..1 shape of a block of time: ramps up over fadeIn, holds, ramps down over fadeOut, 0 outside it. */
function envelope(start: number, duration: number, fadeIn: number, fadeOut: number, curve: Curve, t: number): number {
	const end = start + duration
	if (t < start || t >= end) return 0
	let env = 1
	if (fadeIn > 0 && t < start + fadeIn) env = Math.min(env, ease((t - start) / fadeIn, curve))
	if (fadeOut > 0 && t > end - fadeOut) env = Math.min(env, ease((end - t) / fadeOut, curve))
	return env
}

/** 0..1 brightness of a clip at time t, including its fades. */
export function clipLevel(c: Clip, t: number): number {
	return envelope(c.start, c.duration, c.fadeIn, c.fadeOut, c.curve, t) * c.intensity
}

/**
 * A brightness bump at a point in the show: for `duration` seconds it adds `amount` (0..1) to the
 * brightness of whatever the lights are playing, shaped by the fades, then lets go. Good for
 * hitting a drum or a downbeat harder without rewriting the clips underneath.
 */
export interface Accent {
	id: string
	start: number
	duration: number
	/** brightness added at full strength, as a fraction of full: 0.4 = "+40%" */
	amount: number
	fadeIn: number
	fadeOut: number
	curve: Curve
	/** which lights it hits; null = every light */
	fixtureIds: string[] | null
}

/** Total brightness added to a fixture at time t by every accent that's active (overlaps stack). */
export function accentBoost(accents: Accent[], fixtureId: string, t: number): number {
	let sum = 0
	for (const a of accents) {
		if (a.fixtureIds && !a.fixtureIds.includes(fixtureId)) continue
		sum += envelope(a.start, a.duration, a.fadeIn, a.fadeOut, a.curve, t) * a.amount
	}
	return sum
}

export function projectEnd(clips: Clip[]): number {
	return clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
}

/** The part of a video that plays on the timeline: `length` seconds from `trimIn` of a `duration`-long file, starting at `start`. */
export interface VideoSpan {
	start: number
	duration: number
	trimIn: number
	length: number
}

/** Where in the video file the picture should be at timeline time t, and whether t is inside the bar (so it should be playing). */
export function videoTimeAt(r: VideoSpan, t: number, fileLength: number = r.duration): { inside: boolean; at: number } {
	const rel = t - r.start
	const inside = rel >= 0 && rel < r.length
	const last = Math.min(r.trimIn + r.length, fileLength)
	// outside the bar the video rests on its first or last frame of the used part
	return { inside, at: inside ? r.trimIn + rel : Math.min(Math.max(r.trimIn + rel, r.trimIn), last) }
}

/** Drag the bar's LEFT edge by `delta` seconds: cut (or restore) footage from the front while everything after stays put. */
export function trimStartPatch(r: VideoSpan, delta: number): Pick<VideoSpan, "start" | "trimIn" | "length"> {
	// can't restore footage from before the video's first frame, nor drag the bar before 0:00 on the timeline, nor trim it away entirely
	const d = Math.min(Math.max(delta, -Math.min(r.trimIn, r.start)), r.length - MIN_CLIP)
	return { start: r.start + d, trimIn: r.trimIn + d, length: r.length - d }
}

/** Drag the bar's RIGHT edge to timeline time `end`: cut (or restore) footage from the back. */
export function trimEndPatch(r: VideoSpan, end: number): Pick<VideoSpan, "length"> {
	return { length: Math.min(Math.max(end - r.start, MIN_CLIP), r.duration - r.trimIn) }
}

/** Slide the video's content under a fixed bar: dragging right by `shift` seconds shows earlier footage. */
export function slipPatch(r: VideoSpan, shift: number): Pick<VideoSpan, "trimIn"> {
	return { trimIn: Math.min(Math.max(r.trimIn - shift, 0), r.duration - r.length) }
}

/** End of the whole show: the last light clip or the last audio clip, whichever is later. */
export function showEnd(clips: Clip[], audio: { start: number; duration: number }[]): number {
	return audio.reduce((m, a) => Math.max(m, a.start + a.duration), projectEnd(clips))
}

/**
 * The channel values a fixture actually sends at time t. A fixture with no clips is
 * fully manual; once it has clips the timeline owns its dimmer and colour channels
 * (black between clips) and the rest (strobe, macro, speed) stay on the faders. Accents only
 * brighten lights that have clips.
 */
export function effectiveValues(f: Fixture, clips: Clip[], t: number, accents: Accent[] = [], pose: Pose | null = null): number[] {
	const base = colourValues(f, clips, t, accents)
	// a moving head with frames: the timeline owns where it points as well
	const spec = pose ? motionOf(f) : null
	return pose && spec ? applyPose(base, f.profileId, pose, spec) : base
}

function colourValues(f: Fixture, clips: Clip[], t: number, accents: Accent[]): number[] {
	const own = clips.filter((c) => c.fixtureId === f.id)
	if (own.length === 0) return f.values
	const active = own.find((c) => t >= c.start && t < c.start + c.duration)
	// accents brighten what a clip is playing; between clips the light stays dark
	const level = active ? Math.min(1, clipLevel(active, t) + accentBoost(accents, f.id, t)) : 0
	const channels = profileById(f.profileId).channels
	const hasDimmer = channels.some((c) => c.kind === "dimmer")
	const values = f.values.slice()
	channels.forEach((ch, i) => {
		const base = active ? { red: active.r, green: active.g, blue: active.b }[ch.kind as string] : 0
		if (ch.kind === "dimmer") values[i] = Math.round(255 * level)
		else if (ch.kind === "red" || ch.kind === "green" || ch.kind === "blue") {
			values[i] = Math.round((base ?? 0) * (hasDimmer ? 1 : level))
		}
	})
	return values
}
