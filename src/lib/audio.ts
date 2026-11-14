import type { AudioClip } from "./store"

import { useStore } from "./store"

export interface Loaded {
	buffer: AudioBuffer
	/** min/max pairs, one per BUCKET samples, for drawing the waveform */
	peaks: Float32Array
	bucket: number
}

const BUCKET = 256
/** decoding holds the whole file in memory, so very large videos can't have their sound extracted */
const MAX_DECODE_BYTES = 700 * 1024 * 1024
const cache = new Map<string, Loaded>()
const inflight = new Map<string, Promise<Loaded | null>>()
let ctx: AudioContext | null = null
let sources: AudioBufferSourceNode[] = []

const getCtx = (): AudioContext => (ctx ??= new AudioContext({ latencyHint: "interactive" }))

export const getLoaded = (path: string): Loaded | undefined => cache.get(path)

/** The audio hardware's clock, in seconds. Playback position is derived from this and nothing else. */
export const audioNow = (): number => getCtx().currentTime

/** How long sound takes to get from the app to the speaker, as the device reports it. */
export const deviceLatency = (): number => {
	const c = getCtx()
	return c.outputLatency || c.baseLatency || 0
}

function computePeaks(buffer: AudioBuffer): Float32Array {
	const n = Math.ceil(buffer.length / BUCKET)
	const out = new Float32Array(n * 2)
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch)
		for (let b = 0; b < n; b++) {
			const end = Math.min((b + 1) * BUCKET, data.length)
			let lo = out[2 * b]
			let hi = out[2 * b + 1]
			for (let i = b * BUCKET; i < end; i++) {
				const v = data[i]
				if (v < lo) lo = v
				if (v > hi) hi = v
			}
			out[2 * b] = lo
			out[2 * b + 1] = hi
		}
	}
	return out
}

/** Read and decode an audio file once; later calls reuse it. Reports progress into the store. */
export function loadAudio(path: string): Promise<Loaded | null> {
	const hit = cache.get(path)
	if (hit) return Promise.resolve(hit)
	const running = inflight.get(path)
	if (running) return running
	const setStatus = useStore.getState().setAudioStatus
	setStatus(path, "loading")
	const job = (async (): Promise<Loaded | null> => {
		try {
			// streamed through the local media server, so this works for songs and for a video's soundtrack
			const url = await window.studio?.mediaUrl(path)
			const res = url ? await fetch(url) : null
			if (!res?.ok) {
				setStatus(path, "missing")
				return null
			}
			if (Number(res.headers.get("content-length")) > MAX_DECODE_BYTES) {
				setStatus(path, "missing") // decoding needs the whole file in memory
				return null
			}
			const buffer = await getCtx().decodeAudioData(await res.arrayBuffer())
			const loaded: Loaded = { buffer, peaks: computePeaks(buffer), bucket: BUCKET }
			cache.set(path, loaded)
			setStatus(path, "ready")
			return loaded
		} catch {
			setStatus(path, "missing")
			return null
		} finally {
			inflight.delete(path)
		}
	})()
	inflight.set(path, job)
	return job
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Load a file and put it on the timeline at `at` seconds. Returns its length (0 if it couldn't be read). */
export async function addAudioFromPath(path: string, at: number): Promise<number> {
	const loaded = await loadAudio(path)
	if (!loaded) {
		window.alert(`Couldn't read "${baseName(path)}" as audio.`)
		return 0
	}
	useStore.getState().addAudioClip({ path, name: baseName(path), start: at, duration: loaded.buffer.duration })
	return loaded.buffer.duration
}

export async function pickAudioFiles(): Promise<string[]> {
	return (await window.studio?.openAudio()) ?? []
}

/** Decode every audio file the current show refers to (after opening a show). */
export async function preloadAudio(): Promise<void> {
	await Promise.all(useStore.getState().audioClips.map((c) => loadAudio(c.path)))
}

export function stopPlayback(): void {
	for (const s of sources) {
		try {
			s.stop()
		} catch {
			// already stopped
		}
		s.disconnect()
	}
	sources = []
}

/**
 * Start every audio clip from timeline position `from`. Returns the anchor the transport uses to
 * turn the audio clock back into a timeline position: position = tl + (audioNow() - ctxTime).
 */
export function startPlayback(clips: AudioClip[], from: number): { ctxTime: number; tl: number } {
	stopPlayback()
	const c = getCtx()
	void c.resume()
	const ctxTime = c.currentTime + 0.05 // a short lead so nothing starts late
	for (const clip of clips) {
		const loaded = cache.get(clip.path)
		if (!loaded) continue
		const end = clip.start + clip.duration
		if (from >= end) continue
		const src = c.createBufferSource()
		src.buffer = loaded.buffer
		src.connect(c.destination)
		const offset = Math.max(0, from - clip.start)
		src.start(ctxTime + Math.max(0, clip.start - from), offset, clip.duration - offset)
		sources.push(src)
	}
	return { ctxTime, tl: from }
}
