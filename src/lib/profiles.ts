export type ChannelKind = "dimmer" | "red" | "green" | "blue" | "strobe" | "macro" | "speed" | "other"

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
