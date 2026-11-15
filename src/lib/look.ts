import type { Pose, PoseFrame } from "./motion"
import type { Accent, Clip } from "./show"
import type { Fixture } from "./store"

import { manualPose, motionOf, poseAt } from "./motion"
import { effectiveValues } from "./show"
import { lightTime, previewColor } from "./store"

/** The slice of app state needed to work out what a light looks like right now. */
interface LookState {
	mode: "timeline" | "cues"
	clips: Clip[]
	accents: Accent[]
	frames: PoseFrame[]
	blackout: boolean
	playing: boolean
	playhead: number
	latencyMs: number
	deviceLatencySec: number
}

/**
 * What a light is doing at this instant: its colour (0-255) and how bright it is (0-1). Both the
 * flat stage and the 3D view draw from this, so the two can never disagree.
 */
export function fixtureLook(s: LookState, f: Fixture): { r: number; g: number; b: number; lit: number } {
	const inTimeline = s.mode === "timeline"
	const values = effectiveValues(f, inTimeline ? s.clips : [], lightTime(s), inTimeline ? s.accents : [])
	const c = previewColor(f, values)
	return { r: c.r, g: c.g, b: c.b, lit: s.blackout ? 0 : c.intensity }
}

/**
 * Where a moving head is pointing right now, in degrees: the physics-limited pose from its frames in
 * timeline mode, otherwise wherever its pan/tilt faders say. null for lights that don't move.
 */
export function fixturePose(s: LookState, f: Fixture): Pose | null {
	const spec = motionOf(f)
	if (!spec) return null
	return (s.mode === "timeline" ? poseAt(f, s.frames, lightTime(s)) : null) ?? manualPose(f, spec)
}
