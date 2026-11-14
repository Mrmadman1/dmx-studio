import type { Fixture } from "./store"

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
export function effectiveValues(f: Fixture, clips: Clip[], t: number, accents: Accent[] = []): number[] {
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
