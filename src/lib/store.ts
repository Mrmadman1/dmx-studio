import { create } from "zustand"

import { profileById } from "./profiles"
import { type Accent, type Clip, MIN_CLIP, effectiveValues, showEnd } from "./show"

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

/** What Copy / Cut last took from the timeline (kept in the app, not the system clipboard). */
export interface Clipboard {
	clips: Clip[]
	accents: Accent[]
	audio: AudioClip[]
	/** each copied clip's track position (index into the lights list) when it was copied, so a paste can keep the layout */
	trackOf: Record<string, number>
}

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

/** Rebuild saved accents defensively: drop junk, clamp numbers, keep fades inside the accent. */
function validAccents(list: unknown): Accent[] {
	if (!Array.isArray(list)) return []
	return list.flatMap((raw: unknown): Accent[] => {
		if (!raw || typeof raw !== "object") return []
		const a = raw as Partial<Accent>
		if (typeof a.id !== "string" || !Number.isFinite(a.start) || !Number.isFinite(a.duration)) return []
		const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
		const duration = Math.max(MIN_CLIP, a.duration as number)
		const fadeIn = clamp(num(a.fadeIn, 0), 0, duration)
		const ids = Array.isArray(a.fixtureIds) ? a.fixtureIds.filter((x): x is string => typeof x === "string") : null
		return [
			{
				id: a.id,
				start: Math.max(0, a.start as number),
				duration,
				amount: clamp(num(a.amount, 0.5), 0, 1),
				fadeIn,
				fadeOut: clamp(num(a.fadeOut, 0), 0, duration - fadeIn),
				curve: a.curve === "linear" ? "linear" : "smooth",
				fixtureIds: ids && ids.length ? ids : null,
			},
		]
	})
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
	accents: Accent[]
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
	accents: Accent[]
	selectedAccentId: string | null
	clipboard: Clipboard | null
	/** every selected timeline item (clips, accents, audio). The single-selection ids below mirror it when exactly one is selected. */
	selection: string[]

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

	addAccent: (at: number) => void
	removeAccent: (id: string) => void
	selectAccent: (id: string | null) => void
	updateAccent: (id: string, patch: Partial<Omit<Accent, "id">>) => void

	setSelection: (ids: string[]) => void
	toggleSelected: (id: string) => void
	selectAll: () => void
	deleteSelection: () => void
	splitSelection: (at: number) => void
	/** move every item in `initial` (id -> its start when the drag began) by `delta` seconds; `collide` stops clips running into others */
	moveSelection: (initial: Record<string, number>, delta: number, collide: boolean) => void
	/** drop a copy of each item exactly where it is and select the copies; returns original id -> copy id */
	copySelectionInPlace: (ids: string[]) => Record<string, string>
	/** after dropping copies: push them right if they landed on existing clips */
	settleClips: (ids: string[]) => void

	copySelection: () => void
	cutSelection: () => void
	/** paste at the playhead, keeping the items' spacing (light clips go on the selected light's track) */
	pasteClipboard: () => void
	/** copy the selection and place it straight after the original */
	duplicateSelection: () => void
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
function fit<T extends { duration: number; fadeIn: number; fadeOut: number }>(c: T): T {
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
let accentCounter = 1

const patchClip = (clips: Clip[], id: string, fn: (c: Clip) => Clip): Clip[] =>
	clips.map((c) => (c.id === id ? fn(c) : c))

const nextClipId = (): string => `clip${Date.now()}${clipCounter++}`
const nextAccentId = (): string => `acc${Date.now()}${accentCounter++}`
const nextAudioId = (): string => `aud${Date.now()}${audioCounter++}`

/**
 * Keep the single-selection ids (used by the inspector) and the multi-selection list in step, whichever
 * one an update touches: an explicit list derives the single ids (set only when exactly one item is
 * selected), and touching a single id rebuilds the list from them.
 */
function syncSelection(s: State, p: Partial<State>): Partial<State> {
	if (p.selection) {
		const one = p.selection.length === 1 ? p.selection[0] : null
		const clip = one ? (p.clips ?? s.clips).find((c) => c.id === one) : undefined
		return {
			...p,
			selectedClipId: clip ? clip.id : null,
			selectedAudioId: one && (p.audioClips ?? s.audioClips).some((a) => a.id === one) ? one : null,
			selectedAccentId: one && (p.accents ?? s.accents).some((a) => a.id === one) ? one : null,
			...(clip ? { selectedId: clip.fixtureId } : {}),
		}
	}
	if ("selectedClipId" in p || "selectedAudioId" in p || "selectedAccentId" in p) {
		const pick = (k: "selectedClipId" | "selectedAudioId" | "selectedAccentId"): string | null =>
			(k in p ? p[k] : s[k]) ?? null
		const ids = [pick("selectedClipId"), pick("selectedAudioId"), pick("selectedAccentId")]
		return { ...p, selection: ids.filter((x): x is string => !!x) }
	}
	return p
}

/** The selected items, copied out so they can be pasted or duplicated later. */
function snapshotSelection(s: State): Clipboard | null {
	const ids = new Set(s.selection)
	const clips = s.clips.filter((c) => ids.has(c.id))
	const accents = s.accents.filter((a) => ids.has(a.id))
	const audio = s.audioClips.filter((a) => ids.has(a.id))
	if (!clips.length && !accents.length && !audio.length) return null
	const trackOf: Record<string, number> = {}
	for (const c of clips) trackOf[c.id] = s.fixtures.findIndex((f) => f.id === c.fixtureId)
	return {
		clips: clips.map((c) => ({ ...c })),
		accents: accents.map((a) => ({ ...a, fixtureIds: a.fixtureIds?.slice() ?? null })),
		audio: audio.map((a) => ({ ...a, beats: a.beats?.slice() })),
		trackOf,
	}
}

/** How far to push a group of clips right so none of them touches a clip already on its track. */
function clearanceShift(movers: Clip[], existing: Clip[]): number {
	let shift = 0
	for (let guard = 0; guard < 10000; guard++) {
		let next = shift
		for (const c of movers) {
			const cs = c.start + shift
			for (const o of existing) {
				if (o.fixtureId !== c.fixtureId) continue
				if (cs < o.start + o.duration - 1e-9 && cs + c.duration > o.start + 1e-9) {
					next = Math.max(next, o.start + o.duration - c.start)
				}
			}
		}
		if (next === shift) return shift
		shift = next
	}
	return shift
}

/**
 * Lay a copied group down with its earliest item at `at`, keeping every item's spacing. Light clips
 * keep their relative track layout: with `useSelectedTrack` the top-most copied clip lands on the
 * selected light and the rest keep their offset below it; otherwise each goes back on its own light.
 * The whole group is pushed right, as one piece, until none of it lands on an existing clip.
 */
function placeGroup(
	s: State,
	cb: Clipboard,
	at: number,
	useSelectedTrack: boolean,
): { clips: Clip[]; accents: Accent[]; audio: AudioClip[]; end: number } | null {
	const starts = [...cb.clips, ...cb.accents, ...cb.audio].map((x) => x.start)
	if (!starts.length) return null
	const offset = Math.max(0, at) - Math.min(...starts)
	const n = s.fixtures.length
	const indexOf = new Map(s.fixtures.map((f, i) => [f.id, i]))
	const selectedIdx = useSelectedTrack && s.selectedId ? indexOf.get(s.selectedId) : undefined
	const minTrack = cb.clips.length ? Math.min(...cb.clips.map((c) => cb.trackOf[c.id] ?? 0)) : 0

	const clips: Clip[] =
		n === 0
			? []
			: cb.clips.map((c) => {
					const track = cb.trackOf[c.id] ?? 0
					const fixtureId =
						selectedIdx !== undefined
							? s.fixtures[clamp(selectedIdx + track - minTrack, 0, n - 1)].id
							: indexOf.has(c.fixtureId)
								? c.fixtureId
								: s.fixtures[clamp(track, 0, n - 1)].id
					// a pasted copy is hand-made: it must not be swept up by "Clear flashes"
					return { ...c, id: nextClipId(), fixtureId, start: c.start + offset, source: undefined }
				})
	const shift = clearanceShift(clips, s.clips)
	const placedClips = clips.map((c) => ({ ...c, start: c.start + shift }))
	const accents = cb.accents.map((a) => ({
		...a,
		id: nextAccentId(),
		start: a.start + offset + shift,
		fixtureIds: a.fixtureIds?.slice() ?? null,
	}))
	const audio = cb.audio.map((a) => ({ ...a, id: nextAudioId(), start: a.start + offset + shift, beats: a.beats?.slice() }))
	const placed = [...placedClips, ...accents, ...audio]
	if (!placed.length) return null // e.g. only clips were copied and there are no lights to put them on
	return { clips: placedClips, accents, audio, end: Math.max(...placed.map((x) => x.start + x.duration)) }
}

export const useStore = create<State>((rawSet, get) => {
	/** every update goes through here, so the single-selection ids and the selection list never disagree */
	const set = (partial: Partial<State> | ((s: State) => Partial<State>)): void =>
		rawSet((s) => syncSelection(s, typeof partial === "function" ? partial(s) : partial))
	return {
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
	accents: [],
	selectedAccentId: null,
	clipboard: null,
	selection: [],
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
			// an accent aimed only at this light has nothing left to hit
			accents: s.accents.flatMap((a) => {
				if (!a.fixtureIds) return [a]
				const ids = a.fixtureIds.filter((x) => x !== id)
				return ids.length ? [{ ...a, fixtureIds: ids }] : []
			}),
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
				selectedAccentId: id ? null : s.selectedAccentId,
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
		set((s) => ({
			selectedAudioId: id,
			selectedClipId: id ? null : s.selectedClipId,
			selectedAccentId: id ? null : s.selectedAccentId,
		})),
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

	addAccent: (at) =>
		set((s) => {
			const accent: Accent = {
				id: `acc${Date.now()}${accentCounter++}`,
				start: Math.max(0, at),
				duration: 1,
				amount: 0.5,
				fadeIn: 0.05, // a quick hit...
				fadeOut: 0.4, // ...that settles back
				curve: "smooth",
				fixtureIds: null,
			}
			return {
				accents: [...s.accents, accent],
				selectedAccentId: accent.id,
				selectedClipId: null,
				selectedAudioId: null,
			}
		}),
	removeAccent: (id) =>
		set((s) => ({
			accents: s.accents.filter((a) => a.id !== id),
			selectedAccentId: s.selectedAccentId === id ? null : s.selectedAccentId,
		})),
	selectAccent: (id) =>
		set((s) => ({
			selectedAccentId: id,
			selectedClipId: id ? null : s.selectedClipId,
			selectedAudioId: id ? null : s.selectedAudioId,
		})),
	updateAccent: (id, patch) =>
		set((s) => ({
			accents: s.accents.map((a) => {
				if (a.id !== id) return a
				const next = { ...a, ...patch }
				next.start = Math.max(0, next.start)
				next.duration = Math.max(MIN_CLIP, next.duration)
				next.amount = clamp(next.amount, 0, 1)
				// the fade being dragged wins; the other gives way
				if (patch.fadeIn !== undefined) next.fadeIn = clamp(patch.fadeIn, 0, next.duration - (patch.fadeOut ?? a.fadeOut))
				if (patch.fadeOut !== undefined) next.fadeOut = clamp(patch.fadeOut, 0, next.duration - next.fadeIn)
				return fit(next)
			}),
		})),

	setSelection: (ids) => set({ selection: ids }),
	toggleSelected: (id) =>
		set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
	selectAll: () =>
		set((s) => ({ selection: [...s.clips.map((c) => c.id), ...s.accents.map((a) => a.id), ...s.audioClips.map((a) => a.id)] })),
	deleteSelection: () =>
		set((s) => {
			const ids = new Set(s.selection)
			return {
				clips: s.clips.filter((c) => !ids.has(c.id)),
				accents: s.accents.filter((a) => !ids.has(a.id)),
				audioClips: s.audioClips.filter((a) => !ids.has(a.id)),
				selection: [],
			}
		}),
	splitSelection: (at) => {
		const s = get()
		for (const id of s.selection) if (s.clips.some((c) => c.id === id)) s.splitClip(id, at)
	},
	moveSelection: (initial, delta, collide) =>
		set((s) => {
			const moving = new Set(Object.keys(initial))
			let lo = Number.NEGATIVE_INFINITY
			let hi = Number.POSITIVE_INFINITY
			for (const id of moving) lo = Math.max(lo, -initial[id]) // nothing may go before 0
			if (collide) {
				// clips can't run into clips that aren't coming along
				for (const c of s.clips) {
					if (!moving.has(c.id)) continue
					const s0 = initial[c.id]
					const e0 = s0 + c.duration
					for (const o of s.clips) {
						if (o.fixtureId !== c.fixtureId || moving.has(o.id)) continue
						if (o.start + o.duration <= s0 + 1e-6) lo = Math.max(lo, o.start + o.duration - s0)
						else if (o.start >= e0 - 1e-6) hi = Math.min(hi, o.start - e0)
					}
				}
			}
			const d = clamp(delta, lo, hi)
			const at = <T extends { id: string; start: number }>(x: T): T => (moving.has(x.id) ? { ...x, start: initial[x.id] + d } : x)
			return { clips: s.clips.map(at), accents: s.accents.map(at), audioClips: s.audioClips.map(at) }
		}),
	copySelectionInPlace: (ids) => {
		const s = get()
		const want = new Set(ids)
		const map: Record<string, string> = {}
		const clips = s.clips.filter((c) => want.has(c.id)).map((c) => ({ ...c, id: (map[c.id] = nextClipId()), source: undefined }))
		const accents = s.accents
			.filter((a) => want.has(a.id))
			.map((a) => ({ ...a, id: (map[a.id] = nextAccentId()), fixtureIds: a.fixtureIds?.slice() ?? null }))
		const audio = s.audioClips
			.filter((a) => want.has(a.id))
			.map((a) => ({ ...a, id: (map[a.id] = nextAudioId()), beats: a.beats?.slice() }))
		set({
			clips: [...s.clips, ...clips],
			accents: [...s.accents, ...accents],
			audioClips: [...s.audioClips, ...audio],
			selection: Object.values(map),
		})
		return map
	},
	settleClips: (ids) =>
		set((s) => {
			const moving = new Set(ids)
			const shift = clearanceShift(
				s.clips.filter((c) => moving.has(c.id)),
				s.clips.filter((c) => !moving.has(c.id)),
			)
			if (shift === 0) return {}
			const at = <T extends { id: string; start: number }>(x: T): T => (moving.has(x.id) ? { ...x, start: x.start + shift } : x)
			return { clips: s.clips.map(at), accents: s.accents.map(at), audioClips: s.audioClips.map(at) }
		}),

	copySelection: () => {
		const cb = snapshotSelection(get())
		if (cb) set({ clipboard: cb })
	},
	cutSelection: () => {
		const s = get()
		if (!snapshotSelection(s)) return
		s.copySelection()
		s.deleteSelection()
	},
	pasteClipboard: () =>
		set((s) => {
			if (!s.clipboard) return {}
			const placed = placeGroup(s, s.clipboard, Math.max(0, lightTime(s)), true)
			if (!placed) return {}
			return {
				clips: [...s.clips, ...placed.clips],
				accents: [...s.accents, ...placed.accents],
				audioClips: [...s.audioClips, ...placed.audio],
				selection: [...placed.clips, ...placed.accents, ...placed.audio].map((x) => x.id),
				// move past the paste so the next one chains on (but never shove the playhead during playback)
				...(s.playing ? {} : { playhead: placed.end }),
			}
		}),
	duplicateSelection: () =>
		set((s) => {
			const cb = snapshotSelection(s)
			if (!cb) return {}
			const end = Math.max(...[...cb.clips, ...cb.accents, ...cb.audio].map((x) => x.start + x.duration))
			const placed = placeGroup(s, cb, end, false)
			if (!placed) return {}
			return {
				clips: [...s.clips, ...placed.clips],
				accents: [...s.accents, ...placed.accents],
				audioClips: [...s.audioClips, ...placed.audio],
				selection: [...placed.clips, ...placed.accents, ...placed.audio].map((x) => x.id),
			}
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
			accents: validAccents(p.accents),
			selectedAccentId: null,
			clipboard: null,
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
	}
})

/** Collapse every fixture into the 512 DMX slots that go on the wire. */
export function buildUniverse(
	fixtures: Fixture[],
	clips: Clip[],
	accents: Accent[],
	t: number,
	blackout: boolean,
): Uint8Array {
	const out = new Uint8Array(512)
	if (blackout) return out
	for (const f of fixtures) {
		effectiveValues(f, clips, t, accents).forEach((v, i) => {
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
