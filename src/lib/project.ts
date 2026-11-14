import { useEffect } from "react"

import type { ProjectData } from "./store"

import { preloadAudio } from "./audio"
import { useStore } from "./store"

export function toProject(): ProjectData {
	const s = useStore.getState()
	return {
		version: 1,
		fixtures: s.fixtures,
		clips: s.clips,
		cues: s.cues,
		audioClips: s.audioClips,
		latencyMs: s.latencyMs,
		zoom: s.zoom,
		snap: s.snap,
		mode: s.mode,
		currentCue: s.currentCue,
		reference: s.reference,
	}
}

export async function saveProjectAs(): Promise<boolean> {
	const file = await window.studio?.saveProject(JSON.stringify(toProject(), null, 1))
	return !!file
}

export async function openProject(): Promise<void> {
	const json = await window.studio?.openProject()
	if (!json) return
	try {
		useStore.getState().loadProject(JSON.parse(json) as Partial<ProjectData>)
	} catch {
		window.alert("That file isn't a valid DMX Studio show.")
		return
	}
	await preloadAudio()
}

export function newProject(): void {
	if (!window.confirm("Start a new empty show? The current one is cleared (use Save as first to keep it).")) return
	useStore.getState().loadProject({})
}

/** Restore the last session on start, then keep it autosaved. */
export function usePersistence(): void {
	useEffect(() => {
		let cancelled = false
		let unsubscribe = (): void => {}
		let timer: ReturnType<typeof setTimeout> | undefined
		let ready = false
		const flush = (): void => {
			if (ready) window.studio?.autosave(JSON.stringify(toProject()))
		}

		void (async () => {
			const json = await window.studio?.loadAutosave()
			if (cancelled) return
			if (json) {
				try {
					useStore.getState().loadProject(JSON.parse(json) as Partial<ProjectData>)
					void preloadAudio()
				} catch {
					// a corrupt autosave just means starting empty
				}
			}
			// only start saving once the old session is loaded, or we'd overwrite it with nothing
			ready = true
			unsubscribe = useStore.subscribe((s, prev) => {
				const changed =
					s.fixtures !== prev.fixtures ||
					s.clips !== prev.clips ||
					s.cues !== prev.cues ||
					s.audioClips !== prev.audioClips ||
					s.latencyMs !== prev.latencyMs ||
					s.zoom !== prev.zoom ||
					s.snap !== prev.snap ||
					s.mode !== prev.mode ||
					s.currentCue !== prev.currentCue ||
					s.reference !== prev.reference
				if (!changed) return
				clearTimeout(timer)
				timer = setTimeout(flush, 800)
			})
		})()

		window.addEventListener("beforeunload", flush)
		return () => {
			cancelled = true
			unsubscribe()
			clearTimeout(timer)
			window.removeEventListener("beforeunload", flush)
		}
	}, [])
}
