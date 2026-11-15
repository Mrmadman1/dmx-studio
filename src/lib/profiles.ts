export type ChannelKind =
	| "dimmer"
	| "red"
	| "green"
	| "blue"
	| "strobe"
	| "macro"
	| "speed"
	| "pan"
	| "panFine"
	| "tilt"
	| "tiltFine"
	| "other"

/** The motors in a moving head: how far it can turn, and how fast (degrees, degrees/s, degrees/s²). */
export interface MotionSpec {
	panRange: number
	tiltRange: number
	panSpeed: number
	tiltSpeed: number
	accel: number
}

export interface ChannelDef {
	name: string
	kind: ChannelKind
	/** value the channel starts at when the fixture is added */
	default: number
}

export interface Profile {
	id: string
	name: string
	channels: ChannelDef[]
	/** present for moving heads: the physical limits of their pan/tilt motors */
	motion?: MotionSpec
}

export const PROFILES: Profile[] = [
	{
		id: "par7",
		name: "Generic LED Par (7ch)",
		channels: [
			{ name: "Dimmer", kind: "dimmer", default: 255 },
			{ name: "Red", kind: "red", default: 255 },
			{ name: "Green", kind: "green", default: 255 },
			{ name: "Blue", kind: "blue", default: 255 },
			{ name: "Strobe", kind: "strobe", default: 0 },
			{ name: "Macro", kind: "macro", default: 0 },
			{ name: "Speed", kind: "speed", default: 0 },
		],
	},
	{
		id: "rgb3",
		name: "Generic RGB (3ch)",
		channels: [
			{ name: "Red", kind: "red", default: 255 },
			{ name: "Green", kind: "green", default: 255 },
			{ name: "Blue", kind: "blue", default: 255 },
		],
	},
	{
		id: "drgb4",
		name: "Generic Dimmer+RGB (4ch)",
		channels: [
			{ name: "Dimmer", kind: "dimmer", default: 255 },
			{ name: "Red", kind: "red", default: 255 },
			{ name: "Green", kind: "green", default: 255 },
			{ name: "Blue", kind: "blue", default: 255 },
		],
	},
	{
		// A typical 16-channel LED moving head. Pan and tilt are 16-bit (coarse + fine) and centre at 128/0.
		id: "head16",
		name: "Generic Moving Head (16ch)",
		motion: { panRange: 540, tiltRange: 270, panSpeed: 180, tiltSpeed: 140, accel: 700 },
		channels: [
			{ name: "Pan", kind: "pan", default: 128 },
			{ name: "Pan fine", kind: "panFine", default: 0 },
			{ name: "Tilt", kind: "tilt", default: 128 },
			{ name: "Tilt fine", kind: "tiltFine", default: 0 },
			{ name: "Pan/tilt speed", kind: "speed", default: 0 },
			{ name: "Dimmer", kind: "dimmer", default: 255 },
			{ name: "Strobe", kind: "strobe", default: 0 },
			{ name: "Red", kind: "red", default: 255 },
			{ name: "Green", kind: "green", default: 255 },
			{ name: "Blue", kind: "blue", default: 255 },
			{ name: "White", kind: "other", default: 0 },
			{ name: "Colour macro", kind: "macro", default: 0 },
			{ name: "Gobo", kind: "other", default: 0 },
			{ name: "Gobo rotation", kind: "other", default: 0 },
			{ name: "Focus", kind: "other", default: 0 },
			{ name: "Control", kind: "other", default: 0 },
		],
	},
	{
		id: "par8",
		name: "Generic LED Par (8ch)",
		channels: [
			{ name: "Dimmer", kind: "dimmer", default: 255 },
			{ name: "Red", kind: "red", default: 255 },
			{ name: "Green", kind: "green", default: 255 },
			{ name: "Blue", kind: "blue", default: 255 },
			{ name: "White", kind: "other", default: 0 },
			{ name: "Strobe", kind: "strobe", default: 0 },
			{ name: "Macro", kind: "macro", default: 0 },
			{ name: "Speed", kind: "speed", default: 0 },
		],
	},
]

export const profileById = (id: string): Profile => PROFILES.find((p) => p.id === id) ?? PROFILES[0]
