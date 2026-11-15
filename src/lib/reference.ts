import { loadAudio } from "./audio"
import { useStore } from "./store"

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Load a video as the reference. Its 0:00 plays at timeline second `start`. */
export async function loadReferenceFromPath(path: string, start: number): Promise<boolean> {
	const url = await window.studio?.mediaUrl(path)
	if (!url) {
		window.alert(`Couldn't open "${baseName(path)}".`)
		return false
	}
	try {
		// ask the video itself how long it is, which also proves this machine can play it
		const duration = await new Promise<number>((resolve, reject) => {
			const v = document.createElement("video")
			v.preload = "metadata"
			v.onloadedmetadata = () => {
				resolve(v.duration)
				v.removeAttribute("src")
				v.load()
			}
			v.onerror = () => reject(new Error("unplayable"))
			v.src = url
		})
		if (!Number.isFinite(duration) || duration <= 0) throw new Error("no duration")
		useStore.getState().setReference({
			path,
			name: baseName(path),
			start: Math.max(0, start),
			duration,
			trimIn: 0,
			length: duration,
			muted: false,
			visible: true,
		})
		return true
	} catch {
		window.alert(`This computer can't play "${baseName(path)}". MP4 files (H.264 video, AAC sound) work best.`)
		return false
	}
}

/**
 * Put the video's soundtrack on the audio track, lined up with the video, and silence the video's
 * own sound so it isn't heard twice. That gives it a waveform and lets beat detection run on it.
 */
export async function addReferenceAudio(): Promise<boolean> {
	const s = useStore.getState()
	const ref = s.reference
	if (!ref) return false
	const existing = s.audioClips.find(
		(a) => a.path === ref.path && Math.abs(a.start - ref.start) < 1e-6 && Math.abs((a.offset ?? 0) - ref.trimIn) < 1e-6,
	)
	if (existing) {
		s.selectAudio(existing.id)
		s.updateReference({ muted: true })
		return true
	}
	const loaded = await loadAudio(ref.path)
	if (!loaded) {
		window.alert("Couldn't read the sound from that video. It may be very large, or have no audio track.")
		return false
	}
	const st = useStore.getState()
	// the sound covers exactly the part of the video we use, so the two stay lined up
	const duration = Math.min(ref.length, loaded.buffer.duration - ref.trimIn)
	st.addAudioClip({ path: ref.path, name: `${ref.name} (sound)`, start: ref.start, duration, offset: ref.trimIn })
	st.updateReference({ muted: true })
	return true
}
