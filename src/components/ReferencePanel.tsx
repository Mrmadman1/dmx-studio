import { useEffect, useRef, useState } from "react"

import { lightTime, useStore } from "../lib/store"

/**
 * The reference video, slaved to the timeline. The audio clock owns time; this only follows it:
 * while playing it nudges the video's speed by a hair to stay locked (and hard-seeks if it ever
 * falls more than 0.3 s behind), and while paused it scrubs to wherever the playhead is.
 */
export function ReferencePanel(): React.JSX.Element | null {
	const ref = useStore((s) => s.reference)
	const videoRef = useRef<HTMLVideoElement>(null)
	const [url, setUrl] = useState("")
	const [state, setState] = useState<"loading" | "ok" | "missing" | "unplayable">("loading")
	const path = ref?.path

	useEffect(() => {
		let cancelled = false
		setUrl("")
		setState("loading")
		if (path) {
			void window.studio?.mediaUrl(path).then((u) => {
				if (cancelled) return
				if (u) setUrl(u)
				else setState("missing")
			})
		}
		return () => {
			cancelled = true
		}
	}, [path])

	useEffect(() => {
		const v = videoRef.current
		if (!v || !url) return
		const follow = (): void => {
			const s = useStore.getState()
			const r = s.reference
			if (!r) return
			v.muted = r.muted
			// the picture tracks what's being HEARD, so it lines up with the lights as well
			const target = lightTime(s) - r.start
			const len = Number.isFinite(v.duration) ? v.duration : r.duration
			if (s.playing && target >= 0 && target < len) {
				if (v.paused) void v.play().catch(() => {})
				const diff = target - v.currentTime
				if (Math.abs(diff) > 0.3) v.currentTime = target
				else v.playbackRate = 1 + Math.max(-0.03, Math.min(0.03, diff * 0.25))
			} else {
				if (!v.paused) v.pause()
				v.playbackRate = 1
				const shown = Math.min(Math.max(target, 0), len)
				if (Math.abs(v.currentTime - shown) > 0.04) v.currentTime = shown
			}
		}
		// a timer, not rAF, so the video keeps following when the window is behind another one
		const id = setInterval(follow, 50)
		follow()
		return () => {
			clearInterval(id)
			v.pause()
		}
	}, [url])

	if (!ref) return null
	const message =
		state === "missing"
			? "Video file not found. It may have been moved or deleted."
			: state === "unplayable"
				? "This computer can't play that video. MP4 (H.264 + AAC) works best."
				: ""

	return (
		<main className="relative min-h-0 min-w-0 flex-1 bg-black">
			{url && (
				<video
					ref={videoRef}
					src={url}
					preload="auto"
					playsInline
					className="h-full w-full object-contain"
					onLoadedData={() => setState("ok")}
					onError={() => setState("unplayable")}
				/>
			)}
			{message && (
				<div className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted">{message}</div>
			)}
			<div className="absolute top-2 right-2 flex gap-1">
				<button
					className="rounded bg-black/60 px-2 py-1 text-xs hover:bg-black/80"
					title={ref.muted ? "Turn the video's sound on" : "Mute the video"}
					onClick={() => useStore.getState().updateReference({ muted: !ref.muted })}
				>
					{ref.muted ? "🔇 Sound off" : "🔊 Sound on"}
				</button>
			</div>
			<div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-muted">
				Reference · {ref.name}
			</div>
		</main>
	)
}
