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

/** 0..1 brightness of a clip at time t, including its fades. */
export function clipLevel(c: Clip, t: number): number {
	const end = c.start + c.duration
	if (t < c.start || t >= end) return 0
	let env = 1
	if (c.fadeIn > 0 && t < c.start + c.fadeIn) env = Math.min(env, ease((t - c.start) / c.fadeIn, c.curve))
	if (c.fadeOut > 0 && t > end - c.fadeOut) env = Math.min(env, ease((end - t) / c.fadeOut, c.curve))
	return env * c.intensity
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
 * (black between clips) and the rest (strobe, macro, speed) stay on the faders.
 */
export function effectiveValues(f: Fixture, clips: Clip[], t: number): number[] {
	const own = clips.filter((c) => c.fixtureId === f.id)
	if (own.length === 0) return f.values
	const active = own.find((c) => t >= c.start && t < c.start + c.duration)
	const level = active ? clipLevel(active, t) : 0
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
