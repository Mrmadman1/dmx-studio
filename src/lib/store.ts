import { create } from "zustand"

import { profileById } from "./profiles"
import { type Clip, MIN_CLIP, effectiveValues, showEnd } from "./show"

export interface Fixture {
	id: string
	name: string
	profileId: string
	/** 1-512, the DMX start address set on the physical light */
	address: number
	values: number[]
}

/** A saved look: every light's channel values, plus how long to fade to it. */
export interface Cue {
	id: string
	name: string
	/** seconds to fade from whatever is on stage to this look */
	fade: number
	looks: Record<string, number[]>
}

/** A song on the timeline. The file itself stays on disk; the show only remembers where it is. */
export interface AudioClip {
	id: string
	path: string
	name: string
	/** seconds from the start of the show */
	start: number
	duration: number
	bpm?: number
	/** beat times in seconds, relative to the start of the clip */
	beats?: number[]
}

export type AudioStatus = "loading" | "ready" | "missing"

/** A video to copy the lighting from (concert footage). It plays in step with the timeline. */
export interface Reference {
	path: string
	name: string
	/** timeline second at which the video's own 0:00 plays (can be negative) */
	start: number
	duration: number
	/** silence the video's own sound */
	muted: boolean
	visible: boolean
}

function validReference(r: unknown): Reference | null {
	if (!r || typeof r !== "object") return null
	const v = r as Partial<Reference>
	if (typeof v.path !== "string" || !v.path) return null
	return {
		path: v.path,
		name: typeof v.name === "string" ? v.name : v.path,
		start: Number.isFinite(v.start) ? (v.start as number) : 0,
		duration: Number.isFinite(v.duration) && (v.duration as number) > 0 ? (v.duration as number) : 1,
		muted: v.muted === true,
		visible: v.visible !== false,
	}
}

/** Everything that gets saved to a .dmxshow file / autosave. */
export interface ProjectData {
	version: 1
	fixtures: Fixture[]
	clips: Clip[]
	cues: Cue[]
	audioClips: AudioClip[]
	latencyMs: number
	zoom: number
	snap: boolean
	mode: "timeline" | "cues"
	currentCue: number
	reference: Reference | null
}

type Looks = Record<string, number[]>

interface State {
	fixtures: Fixture[]
	selectedId: string | null
	blackout: boolean

	mode: "timeline" | "cues"
	cues: Cue[]
	/** index of the cue last sent with GO, -1 before the first */
	currentCue: number
	selectedCueId: string | null
	fading: { from: Looks; to: Looks; start: number; duration: number } | null

	audioClips: AudioClip[]
	selectedAudioId: string | null
	/** extra delay (ms) between the playhead and the lights, to line up slow speakers (Bluetooth) */
	latencyMs: number
	/** the sound device's own reported delay in seconds (runtime only, never saved) */
	deviceLatencySec: number
	audioStatus: Record<string, AudioStatus>
	reference: Reference | null

	clips: Clip[]
	selectedClipId: string | null
	/** seconds */
	playhead: number
	playing: boolean
	/** timeline pixels per second */
	zoom: number
	snap: boolean

	addFixture: (profileId: string) => void
	removeFixture: (id: string) => void
	selectFixture: (id: string | null) => void
	setValue: (id: string, channel: number, value: number) => void
	setRgb: (id: string, r: number, g: number, b: number) => void
	setAddress: (id: string, address: number) => void
	renameFixture: (id: string, name: string) => void
	setBlackout: (on: boolean) => void

	addClip: (fixtureId: string, at: number) => void
	removeClip: (id: string) => void
	selectClip: (id: string | null) => void
	updateClip: (id: string, patch: Partial<Omit<Clip, "id" | "fixtureId" | "start" | "duration">>) => void
	moveClip: (id: string, start: number) => void
	trimStart: (id: string, start: number) => void
	trimEnd: (id: string, end: number) => void
	splitClip: (id: string, at: number) => void
	setPlayhead: (t: number) => void
	setPlaying: (on: boolean) => void
	togglePlay: () => void
	setZoom: (z: number) => void
	setSnap: (on: boolean) => void

	setMode: (m: "timeline" | "cues") => void
	recordCue: () => void
	updateCueLook: (id: string) => void
	updateCue: (id: string, patch: Partial<Pick<Cue, "name" | "fade">>) => void
	removeCue: (id: string) => void
	moveCue: (id: string, dir: -1 | 1) => void
	selectCue: (id: string | null) => void
	goCue: (index: number) => void
	goNext: () => void
	goBack: () => void
	tickFade: (now: number) => void

	addAudioClip: (c: Omit<AudioClip, "id">) => void
	removeAudioClip: (id: string) => void
	moveAudioClip: (id: string, start: number) => void
	selectAudio: (id: string | null) => void
	setAudioBeats: (id: string, bpm: number, beats: number[]) => void
	setLatencyMs: (ms: number) => void
	setDeviceLatency: (sec: number) => void
	setAudioStatus: (path: string, status: AudioStatus) => void
	/** drop a short flash on each light's track every `every` beats; returns how many were added */
	addBeatClips: (audioId: string, fixtureIds: string[], every: number) => number
	clearBeatClips: (audioId: string) => void
	loadProject: (p: Partial<ProjectData>) => void
	setReference: (r: Reference | null) => void
	updateReference: (patch: Partial<Reference>) => void
}

/**
 * Where the lights should be on the timeline right now. While playing, the lights trail the
 * playhead by the sound device's delay plus the user's offset, so they land with what is HEARD.
 */
export function lightTime(s: {
	playing: boolean
	playhead: number
	latencyMs: number
	deviceLatencySec: number
}): number {
	return s.playing ? s.playhead - s.latencyMs / 1000 - s.deviceLatencySec : s.playhead
}

/** Everything with a length on the media tracks (songs and the reference video), for working out the show's end. */
export function mediaSpans(s: {
	audioClips: AudioClip[]
	reference: Reference | null
}): { start: number; duration: number }[] {
	return s.reference ? [...s.audioClips, { start: s.reference.start, duration: s.reference.duration }] : s.audioClips
}

const snapshot = (fixtures: Fixture[]): Looks => Object.fromEntries(fixtures.map((f) => [f.id, f.values.slice()]))

const fadable = (kind: string): boolean => kind === "dimmer" || kind === "red" || kind === "green" || kind === "blue"

/** Write a cue's look straight onto the fixtures (those the cue knows about). */
function applyLooks(fixtures: Fixture[], looks: Looks): Fixture[] {
	return fixtures.map((f) => {
		const look = looks[f.id]
		return look && look.length === f.values.length ? { ...f, values: look.slice() } : f
	})
}

/** first start address where `count` channels fit without overlapping an existing fixture */
function nextFreeAddress(fixtures: Fixture[], count: number): number {
	const spans = fixtures
		.map((f) => ({ start: f.address, end: f.address + profileById(f.profileId).channels.length - 1 }))
		.sort((a, b) => a.start - b.start)
	let candidate = 1
	for (const s of spans) {
		if (candidate + count - 1 < s.start) break
		candidate = Math.max(candidate, s.end + 1)
	}
	return Math.min(candidate, 512)
}

/** How far a clip may move/grow before it would run into its neighbours on the same track. */
function bounds(clips: Clip[], c: Clip): { min: number; max: number } {
	let min = 0
	let max = Number.POSITIVE_INFINITY
	for (const o of clips) {
		if (o.fixtureId !== c.fixtureId || o.id === c.id) continue
		if (o.start + o.duration <= c.start + 1e-6) min = Math.max(min, o.start + o.duration)
		else if (o.start >= c.start + c.duration - 1e-6) max = Math.min(max, o.start)
	}
	return { min, max }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** keep fadeIn + fadeOut inside the clip's length */
function fit(c: Clip): Clip {
	const fadeIn = clamp(c.fadeIn, 0, c.duration)
	return { ...c, fadeIn, fadeOut: clamp(c.fadeOut, 0, c.duration - fadeIn) }
}

const PALETTE: [number, number, number][] = [
	[255, 40, 90],
	[0, 160, 255],
	[110, 255, 40],
	[255, 170, 0],
	[180, 60, 255],
]

let counter = 1
let clipCounter = 1
let cueCounter = 1
let audioCounter = 1

const patchClip = (clips: Clip[], id: string, fn: (c: Clip) => Clip): Clip[] =>
	clips.map((c) => (c.id === id ? fn(c) : c))

export const useStore = create<State>((set, get) => ({
	fixtures: [],
	selectedId: null,
	blackout: false,
	mode: "timeline",
	cues: [],
	currentCue: -1,
	selectedCueId: null,
	fading: null,
	audioClips: [],
	selectedAudioId: null,
	latencyMs: 0,
	deviceLatencySec: 0,
	audioStatus: {},
	reference: null,
	clips: [],
	selectedClipId: null,
	playhead: 0,
	playing: false,
	zoom: 60,
	snap: true,

	addFixture: (profileId) =>
		set((s) => {
			const profile = profileById(profileId)
			const fixture: Fixture = {
				id: `fx${Date.now()}${counter}`,
				name: `${profile.name.replace(/^Generic /, "")} ${counter++}`,
				profileId,
				address: nextFreeAddress(s.fixtures, profile.channels.length),
				values: profile.channels.map((c) => c.default),
			}
			return { fixtures: [...s.fixtures, fixture], selectedId: fixture.id }
		}),
	removeFixture: (id) =>
		set((s) => ({
			fixtures: s.fixtures.filter((f) => f.id !== id),
			clips: s.clips.filter((c) => c.fixtureId !== id),
			selectedId: s.selectedId === id ? null : s.selectedId,
			selectedClipId: s.clips.some((c) => c.id === s.selectedClipId && c.fixtureId === id)
				? null
				: s.selectedClipId,
		})),
	selectFixture: (id) => set({ selectedId: id }),
	setValue: (id, channel, value) =>
		set((s) => ({
			fading: null, // grabbing a fader takes over from a running cue fade
			fixtures: s.fixtures.map((f) =>
				f.id === id ? { ...f, values: f.values.map((v, i) => (i === channel ? value : v)) } : f,
			),
		})),
	setRgb: (id, r, g, b) =>
		set((s) => ({
			fading: null,
			fixtures: s.fixtures.map((f) => {
				if (f.id !== id) return f
				const ch = profileById(f.profileId).channels
				const values = f.values.slice()
				ch.forEach((c, i) => {
					if (c.kind === "red") values[i] = r
					if (c.kind === "green") values[i] = g
					if (c.kind === "blue") values[i] = b
				})
				return { ...f, values }
			}),
		})),
	setAddress: (id, address) =>
		set((s) => ({
			fixtures: s.fixtures.map((f) =>
				f.id === id ? { ...f, address: Math.max(1, Math.min(512, Math.round(address) || 1)) } : f,
			),
		})),
	renameFixture: (id, name) =>
		set((s) => ({ fixtures: s.fixtures.map((f) => (f.id === id ? { ...f, name } : f)) })),
	setBlackout: (blackout) => set({ blackout }),

	addClip: (fixtureId, at) =>
		set((s) => {
			const sib = s.clips.filter((c) => c.fixtureId === fixtureId).sort((a, b) => a.start - b.start)
			let start = Math.max(0, at)
			for (const o of sib) {
				if (start < o.start + o.duration && start + MIN_CLIP > o.start) start = o.start + o.duration
			}
			const next = sib.find((o) => o.start >= start)
			const duration = Math.min(4, next ? next.start - start : 4)
			if (duration < 0.2) return {}
			const [r, g, b] = PALETTE[(clipCounter - 1) % PALETTE.length]
			const fade = Math.min(0.5, duration / 2)
			const clip: Clip = {
				id: `clip${Date.now()}${clipCounter++}`,
				fixtureId,
				start,
				duration,
				r,
				g,
				b,
				intensity: 1,
				fadeIn: fade,
				fadeOut: fade,
				curve: "smooth",
			}
			return { clips: [...s.clips, clip], selectedClipId: clip.id, selectedId: fixtureId }
		}),
	removeClip: (id) =>
		set((s) => ({
			clips: s.clips.filter((c) => c.id !== id),
			selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
		})),
	selectClip: (id) =>
		set((s) => {
			const clip = s.clips.find((c) => c.id === id)
			return {
				selectedClipId: id,
				selectedAudioId: id ? null : s.selectedAudioId,
				selectedId: clip ? clip.fixtureId : s.selectedId,
			}
		}),
	updateClip: (id, patch) =>
		set((s) => ({
			clips: patchClip(s.clips, id, (c) => {
				const next = { ...c, ...patch }
				// the fade being edited wins; the other one gives way
				if (patch.fadeIn !== undefined) next.fadeIn = clamp(patch.fadeIn, 0, c.duration - c.fadeOut)
				if (patch.fadeOut !== undefined) next.fadeOut = clamp(patch.fadeOut, 0, c.duration - c.fadeIn)
				return next
			}),
		})),
	moveClip: (id, start) =>
		set((s) => {
			const c = s.clips.find((x) => x.id === id)
			if (!c) return {}
			const { min, max } = bounds(s.clips, c)
			const ns = clamp(start, min, Math.max(min, max - c.duration))
			return { clips: patchClip(s.clips, id, (x) => ({ ...x, start: ns })) }
		}),
	trimStart: (id, start) =>
		set((s) => {
			const c = s.clips.find((x) => x.id === id)
			if (!c) return {}
			const { min } = bounds(s.clips, c)
			const end = c.start + c.duration
			const ns = clamp(start, min, end - MIN_CLIP)
			return { clips: patchClip(s.clips, id, (x) => fit({ ...x, start: ns, duration: end - ns })) }
		}),
	trimEnd: (id, end) =>
		set((s) => {
			const c = s.clips.find((x) => x.id === id)
			if (!c) return {}
			const { max } = bounds(s.clips, c)
			const ne = clamp(end, c.start + MIN_CLIP, Math.max(c.start + MIN_CLIP, max))
			return { clips: patchClip(s.clips, id, (x) => fit({ ...x, duration: ne - x.start })) }
		}),
	splitClip: (id, at) =>
		set((s) => {
			const c = s.clips.find((x) => x.id === id)
			if (!c) return {}
			const end = c.start + c.duration
			if (at < c.start + MIN_CLIP || at > end - MIN_CLIP) return {}
			const left = fit({ ...c, duration: at - c.start, fadeOut: 0 })
			const right = fit({
				...c,
				id: `clip${Date.now()}${clipCounter++}`,
				start: at,
				duration: end - at,
				fadeIn: 0,
			})
			return { clips: [...s.clips.filter((x) => x.id !== id), left, right] }
		}),

	setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
	setPlaying: (playing) => set({ playing }),
	togglePlay: () =>
		set((s) => {
			if (s.playing) return { playing: false }
			const end = showEnd(s.clips, mediaSpans(s))
			return { playing: end > 0, playhead: s.playhead >= end ? 0 : s.playhead }
		}),
	setZoom: (zoom) => set({ zoom: clamp(zoom, 15, 300) }),
	setSnap: (snap) => set({ snap }),

	setMode: (mode) => set({ mode, playing: false, fading: null }),
	recordCue: () =>
		set((s) => {
			const cue: Cue = {
				id: `cue${Date.now()}${cueCounter}`,
				name: `Cue ${cueCounter++}`,
				fade: 1,
				looks: snapshot(s.fixtures),
			}
			// what's on stage IS this cue, so the next GO moves on to the one after it
			return { cues: [...s.cues, cue], currentCue: s.cues.length, selectedCueId: cue.id, fading: null }
		}),
	updateCueLook: (id) =>
		set((s) => ({ cues: s.cues.map((c) => (c.id === id ? { ...c, looks: snapshot(s.fixtures) } : c)) })),
	updateCue: (id, patch) =>
		set((s) => ({
			cues: s.cues.map((c) =>
				c.id === id
					? { ...c, ...patch, fade: patch.fade === undefined ? c.fade : Math.max(0, patch.fade) }
					: c,
			),
		})),
	removeCue: (id) =>
		set((s) => {
			const idx = s.cues.findIndex((c) => c.id === id)
			if (idx < 0) return {}
			// the current-cue marker follows its cue; deleting the live one falls back to the previous
			const currentCue = idx <= s.currentCue ? s.currentCue - 1 : s.currentCue
			return {
				cues: s.cues.filter((c) => c.id !== id),
				currentCue,
				selectedCueId: s.selectedCueId === id ? null : s.selectedCueId,
			}
		}),
	moveCue: (id, dir) =>
		set((s) => {
			const i = s.cues.findIndex((c) => c.id === id)
			const j = i + dir
			if (i < 0 || j < 0 || j >= s.cues.length) return {}
			const liveId = s.cues[s.currentCue]?.id
			const cues = s.cues.slice()
			;[cues[i], cues[j]] = [cues[j], cues[i]]
			return { cues, currentCue: liveId ? cues.findIndex((c) => c.id === liveId) : -1 }
		}),
	selectCue: (selectedCueId) => set({ selectedCueId }),
	goCue: (index) =>
		set((s) => {
			const cue = s.cues[index]
			if (!cue) return {}
			if (cue.fade <= 0) {
				return {
					currentCue: index,
					selectedCueId: cue.id,
					fixtures: applyLooks(s.fixtures, cue.looks),
					fading: null,
				}
			}
			return {
				currentCue: index,
				selectedCueId: cue.id,
				fading: { from: snapshot(s.fixtures), to: cue.looks, start: performance.now(), duration: cue.fade * 1000 },
			}
		}),
	goNext: () => {
		const s = get()
		if (s.currentCue + 1 < s.cues.length) s.goCue(s.currentCue + 1)
	},
	goBack: () => {
		const s = get()
		if (s.currentCue > 0) s.goCue(s.currentCue - 1)
	},
	tickFade: (now) =>
		set((s) => {
			const fd = s.fading
			if (!fd) return {}
			const p = Math.min(1, (now - fd.start) / fd.duration)
			const fixtures = s.fixtures.map((f) => {
				const to = fd.to[f.id]
				const from = fd.from[f.id]
				if (!to || !from || to.length !== f.values.length || from.length !== f.values.length) return f
				const channels = profileById(f.profileId).channels
				// colour and brightness glide; strobe/macro/speed just switch at the start
				const values = to.map((t, i) => (fadable(channels[i].kind) ? Math.round(from[i] + (t - from[i]) * p) : t))
				return { ...f, values }
			})
			return { fixtures, fading: p >= 1 ? null : fd }
		}),

	addAudioClip: (c) =>
		set((s) => {
			const clip: AudioClip = { ...c, id: `aud${Date.now()}${audioCounter++}`, start: Math.max(0, c.start) }
			return { audioClips: [...s.audioClips, clip], selectedAudioId: clip.id, selectedClipId: null }
		}),
	removeAudioClip: (id) =>
		set((s) => ({
			audioClips: s.audioClips.filter((a) => a.id !== id),
			selectedAudioId: s.selectedAudioId === id ? null : s.selectedAudioId,
		})),
	moveAudioClip: (id, start) =>
		set((s) => ({
			audioClips: s.audioClips.map((a) => (a.id === id ? { ...a, start: Math.max(0, start) } : a)),
		})),
	selectAudio: (id) =>
		set((s) => ({ selectedAudioId: id, selectedClipId: id ? null : s.selectedClipId })),
	setAudioBeats: (id, bpm, beats) =>
		set((s) => ({ audioClips: s.audioClips.map((a) => (a.id === id ? { ...a, bpm, beats } : a)) })),
	setLatencyMs: (ms) => set({ latencyMs: clamp(Math.round(ms), -500, 1500) }),
	setDeviceLatency: (deviceLatencySec) => set({ deviceLatencySec }),
	setAudioStatus: (path, status) => set((s) => ({ audioStatus: { ...s.audioStatus, [path]: status } })),
	addBeatClips: (audioId, fixtureIds, every) => {
		let added = 0
		set((s) => {
			const a = s.audioClips.find((x) => x.id === audioId)
			if (!a?.beats?.length || !a.bpm) return {}
			const span = (60 / a.bpm) * every
			// a punchy flash that decays before the next one lands
			const dur = Math.min(span * 0.9, 2)
			const times = a.beats.filter((_, i) => i % every === 0).map((b) => a.start + b)
			const next = s.clips.slice()
			fixtureIds.forEach((fid, fi) => {
				times.forEach((t, bi) => {
					if (next.some((o) => o.fixtureId === fid && t < o.start + o.duration && t + dur > o.start)) return
					const [r, g, b] = PALETTE[(bi + fi) % PALETTE.length]
					next.push({
						id: `clip${Date.now()}${clipCounter++}`,
						fixtureId: fid,
						start: t,
						duration: dur,
						r,
						g,
						b,
						intensity: 1,
						fadeIn: 0,
						fadeOut: dur,
						curve: "smooth",
						source: audioId,
					})
					added++
				})
			})
			return { clips: next }
		})
		return added
	},
	clearBeatClips: (audioId) =>
		set((s) => {
			const clips = s.clips.filter((c) => c.source !== audioId)
			const gone = s.selectedClipId && !clips.some((c) => c.id === s.selectedClipId)
			return { clips, selectedClipId: gone ? null : s.selectedClipId }
		}),

	setReference: (reference) => set({ reference }),
	updateReference: (patch) => set((s) => (s.reference ? { reference: { ...s.reference, ...patch } } : {})),

	loadProject: (p) =>
		set({
			fixtures: Array.isArray(p.fixtures) ? p.fixtures : [],
			clips: Array.isArray(p.clips) ? p.clips : [],
			cues: Array.isArray(p.cues) ? p.cues : [],
			audioClips: Array.isArray(p.audioClips) ? p.audioClips : [],
			latencyMs: Number.isFinite(p.latencyMs) ? (p.latencyMs as number) : 0,
			zoom: clamp(Number(p.zoom) || 60, 15, 300),
			snap: p.snap !== false,
			mode: p.mode === "cues" ? "cues" : "timeline",
			currentCue: Number.isInteger(p.currentCue) ? (p.currentCue as number) : -1,
			reference: validReference(p.reference),
			// everything that only makes sense mid-session starts fresh
			selectedId: null,
			selectedClipId: null,
			selectedAudioId: null,
			selectedCueId: null,
			playhead: 0,
			playing: false,
			fading: null,
			blackout: false,
		}),
}))

/** Collapse every fixture into the 512 DMX slots that go on the wire. */
export function buildUniverse(fixtures: Fixture[], clips: Clip[], t: number, blackout: boolean): Uint8Array {
	const out = new Uint8Array(512)
	if (blackout) return out
	for (const f of fixtures) {
		effectiveValues(f, clips, t).forEach((v, i) => {
			const slot = f.address - 1 + i
			if (slot >= 0 && slot < 512) out[slot] = v
		})
	}
	return out
}

/** The on-screen colour of a fixture (what the preview draws). */
export function previewColor(
	f: Fixture,
	values: number[] = f.values,
): { r: number; g: number; b: number; intensity: number } {
	const ch = profileById(f.profileId).channels
	const get = (kind: string): number => {
		const i = ch.findIndex((c) => c.kind === kind)
		return i < 0 ? -1 : values[i]
	}
	const dim = get("dimmer")
	return {
		r: Math.max(0, get("red")),
		g: Math.max(0, get("green")),
		b: Math.max(0, get("blue")),
		intensity: dim < 0 ? 1 : dim / 255,
	}
}
