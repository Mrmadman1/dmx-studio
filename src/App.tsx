import { useEffect } from "react"

import { AssetDrawer } from "./components/AssetDrawer"
import { CuePanel } from "./components/CuePanel"
import { HelpGuide, welcomeSeen } from "./components/HelpGuide"
import { Inspector } from "./components/Inspector"
import { ProjectionView } from "./components/ProjectionView"
import { ReferencePanel } from "./components/ReferencePanel"
import { Stage } from "./components/Stage"
import { Timeline } from "./components/Timeline"
import { TopBar } from "./components/TopBar"
import { audioNow, deviceLatency, startPlayback, stopPlayback } from "./lib/audio"
import { usePersistence } from "./lib/project"
import { showEnd } from "./lib/show"
import { buildTestUniverse, buildUniverse, lightTime, mediaSpans, useStore } from "./lib/store"

/** Push the universe to the DMX engine on every change (no rAF: it must keep going in the background). */
function useDmxOutput(): void {
	useEffect(() => {
		const push = (): void => {
			const s = useStore.getState()
			// the timeline's clips only drive the lights in timeline mode; cue mode writes values directly
			if (s.testLights && !s.blackout) {
				window.dmx?.sendFrame(buildTestUniverse(s.fixtures))
				return
			}
			const inTimeline = s.mode === "timeline"
			window.dmx?.sendFrame(
				buildUniverse(
					s.fixtures,
					inTimeline ? s.clips : [],
					inTimeline ? s.accents : [],
					inTimeline ? s.frames : [],
					lightTime(s),
					s.blackout,
				),
			)
		}
		push()
		return useStore.subscribe(push)
	}, [])
}

/**
 * Play the show. The audio hardware's clock is the one master clock: the playhead is computed from
 * it (never from a separate timer that could drift), and the lights read the playhead, so sound
 * and light cannot slip apart. A timer, not rAF, so it survives a hidden window.
 */
function useTransport(): void {
	const playing = useStore((s) => s.playing)
	useEffect(() => {
		if (!playing) {
			stopPlayback()
			return
		}
		const st = useStore.getState
		let anchor = startPlayback(st().audioClips, st().playhead)
		st().setDeviceLatency(deviceLatency())
		let expected = st().playhead
		const id = setInterval(() => {
			const s = st()
			if (Math.abs(s.playhead - expected) > 0.05) {
				// the playhead was dragged while playing: restart the sound from the new spot
				anchor = startPlayback(s.audioClips, s.playhead)
				expected = s.playhead
			}
			const t = anchor.tl + Math.max(0, audioNow() - anchor.ctxTime)
			const end = showEnd(s.clips, mediaSpans(s))
			expected = t
			if (t >= end) {
				s.setPlayhead(end)
				s.setPlaying(false)
			} else {
				s.setPlayhead(t)
			}
		}, 16)
		return () => {
			clearInterval(id)
			stopPlayback()
		}
	}, [playing])
}

/** Keep the projector window up to date: it renders from the same setup the editor is showing. */
function useProjectionSync(): void {
	useEffect(() => {
		const push = (): void => window.studio?.projectionSend(JSON.stringify(useStore.getState().projection))
		push()
		return useStore.subscribe((s, prev) => {
			if (s.projection !== prev.projection) push()
		})
	}, [])
}

/** Run a cue's fade while one is in progress. */
function useCueFade(): void {
	const fading = useStore((s) => s.fading !== null)
	useEffect(() => {
		if (!fading) return
		const id = setInterval(() => useStore.getState().tickFade(performance.now()), 16)
		return () => clearInterval(id)
	}, [fading])
}

function useShortcuts(): void {
	useEffect(() => {
		const isTyping = (el: HTMLElement): boolean =>
			el.tagName === "SELECT" ||
			el.tagName === "TEXTAREA" ||
			(el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")

		const onKey = (e: KeyboardEvent): void => {
			const el = e.target as HTMLElement
			if (isTyping(el)) return
			const s = useStore.getState()
			if (e.ctrlKey || e.metaKey) {
				// Ctrl+C / X / V / D on the timeline (never while typing in a box, so text copy still works)
				if (e.altKey) return
				const key = e.key.toLowerCase()
				if (key === "z" || key === "y") {
					if (key === "y" || e.shiftKey) s.redo()
					else s.undo()
					e.preventDefault()
					return
				}
				if (s.mode !== "timeline") return
				if (key === "a") s.selectAll()
				else if (key === "c") s.copySelection()
				else if (key === "x") s.cutSelection()
				else if (key === "v") s.pasteClipboard()
				else if (key === "d") s.duplicateSelection()
				else return
				e.preventDefault()
				return
			}
			if (e.altKey) return
			if (e.code === "Space") {
				e.preventDefault()
				// a focused button would also "click" on Space; drop the focus so only we handle it
				if (el.tagName === "BUTTON") el.blur()
				if (s.mode === "cues") s.goNext()
				else s.togglePlay()
				return
			}
			if (s.mode === "cues") {
				if (el.tagName === "INPUT") return // arrows belong to a focused slider
				if (e.key === "ArrowRight") s.goNext()
				else if (e.key === "ArrowLeft") s.goBack()
				else if (e.key === "Delete" && s.selectedCueId) s.removeCue(s.selectedCueId)
				return
			}
			if (e.key === "s" || e.key === "S") {
				s.splitSelection(s.playhead)
			} else if (e.key === "Delete" || e.key === "Backspace") {
				s.deleteSelection()
			} else if (e.key === "Escape") {
				s.setSelection([])
			} else if (e.key === "k" || e.key === "K") {
				// a movement frame for the selected moving head, at the pose it's in right now
				if (s.selectedId) s.addFrame(s.selectedId, Math.max(0, lightTime(s)))
			} else if (e.key === "a" || e.key === "A") {
				// tap A on a hit while the song plays: it lands where you HEARD it (lightTime), not where the audio is scheduled
				s.addAccent(Math.max(0, lightTime(s)))
			} else if (e.key === "Home") {
				s.setPlayhead(0)
			}
		}
		const onKeyUp = (e: KeyboardEvent): void => {
			if (e.code === "Space" && !isTyping(e.target as HTMLElement)) e.preventDefault()
		}
		window.addEventListener("keydown", onKey)
		window.addEventListener("keyup", onKeyUp)
		return () => {
			window.removeEventListener("keydown", onKey)
			window.removeEventListener("keyup", onKeyUp)
		}
	}, [])
}

/** The stage, with the reference video beside it (or above it, in a narrow window) when there is one. */
function Center(): React.JSX.Element {
	const showVideo = useStore((s) => !!s.reference?.visible)
	return (
		<div className="@container flex min-h-0 min-w-0 flex-col gap-px bg-line @3xl:flex-row">
			{showVideo && <ReferencePanel />}
			<Stage />
		</div>
	)
}

export function App(): React.JSX.Element {
	usePersistence()
	useDmxOutput()
	useTransport()
	useCueFade()
	useShortcuts()
	useProjectionSync()
	// first time the app opens, show the guide (after the saved show has had a moment to load)
	useEffect(() => {
		if (welcomeSeen()) return
		const t = setTimeout(() => {
			if (useStore.getState().fixtures.length === 0) useStore.getState().setHelpOpen(true)
		}, 900)
		return () => clearTimeout(t)
	}, [])
	const mode = useStore((s) => s.mode)
	const workspace = useStore((s) => s.workspace)
	if (workspace === "projection") {
		return (
			<div className="grid h-full w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-px overflow-hidden bg-line">
				<TopBar />
				<ProjectionView />
				<HelpGuide />
			</div>
		)
	}
	return (
		<div className="grid h-full w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_minmax(220px,36vh)] gap-px overflow-hidden bg-line">
			<TopBar />
			<div className="grid min-h-0 grid-cols-[minmax(200px,320px)_minmax(0,1fr)_minmax(220px,340px)] gap-px">
				<AssetDrawer />
				<Center />
				<Inspector />
			</div>
			{mode === "timeline" ? <Timeline /> : <CuePanel />}
			<HelpGuide />
		</div>
	)
}
