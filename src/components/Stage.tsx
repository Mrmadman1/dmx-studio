import { Component, type ReactNode, Suspense, lazy, useEffect, useState } from "react"

import { useStore } from "../lib/store"
import { StagePreview } from "./StagePreview"

// three.js is large and only needed once someone opens the 3D view, so it loads on demand
const Stage3D = lazy(() => import("./Stage3D"))

/** If the graphics card can't start WebGL, show why and offer the flat stage instead of a blank panel. */
class GlBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
	state = { failed: false }
	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true }
	}
	render(): ReactNode {
		if (!this.state.failed) return this.props.children
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-muted">
				<p>The 3D view couldn't start on this computer (WebGL isn't available).</p>
				<button className="rounded border border-line bg-panel2 px-3 py-1 text-white hover:bg-line" onClick={this.props.onFail}>
					Use the flat stage
				</button>
			</div>
		)
	}
}

const isTyping = (el: HTMLElement): boolean =>
	el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")

const btn = (on: boolean): string =>
	`rounded px-2 py-1 text-xs ${on ? "bg-accent font-medium text-black" : "bg-black/60 text-white hover:bg-black/80"}`

// the model loader is part of the 3D chunk too, so it's only fetched when it's needed
const loadStage = (): void => void import("../lib/stageModel").then((m) => m.loadDemoStage())
const removeStage = (): void => void import("../lib/stageModel").then((m) => m.removeStage())

/** The middle panel: the flat stage or the 3D one, with a switch and (in 3D) the stage and move/rotate tools. */
export function Stage(): React.JSX.Element {
	const view = useStore((s) => s.stageView)
	const setView = useStore((s) => s.setStageView)
	const hasLights = useStore((s) => s.fixtures.length > 0)
	const addFixture = useStore((s) => s.addFixture)
	const setHelpOpen = useStore((s) => s.setHelpOpen)
	const stage = useStore((s) => s.stage)
	const stageStatus = useStore((s) => s.stageStatus)
	const stageError = useStore((s) => s.stageError)
	const [tool, setTool] = useState<"translate" | "rotate">("translate")
	const [snap, setSnap] = useState(true)
	const [frameTick, setFrameTick] = useState(0)
	const [ambient, setAmbient] = useState(1)

	// a show saved with the demo stage brings it back the next time the 3D view is opened
	useEffect(() => {
		if (view === "3d" && stage === "demo" && stageStatus === "idle") loadStage()
	}, [view, stage, stageStatus])

	// Unity-style keys, only while the 3D view is up: W move, E rotate, F frame
	useEffect(() => {
		if (view !== "3d") return
		const onKey = (e: KeyboardEvent): void => {
			if (isTyping(e.target as HTMLElement) || e.ctrlKey || e.metaKey || e.altKey) return
			const k = e.key.toLowerCase()
			if (k === "w") setTool("translate")
			else if (k === "e") setTool("rotate")
			else if (k === "f") setFrameTick((t) => t + 1)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [view])

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1">
			{view === "2d" ? (
				<StagePreview />
			) : (
				<GlBoundary onFail={() => setView("2d")}>
					<Suspense fallback={<div className="flex flex-1 items-center justify-center bg-bg text-muted">Loading 3D…</div>}>
						<Stage3D tool={tool} snap={snap} frameTick={frameTick} ambient={ambient} />
					</Suspense>
				</GlBoundary>
			)}

			{!hasLights && (
				<div className="absolute inset-0 z-[5] flex items-center justify-center p-4">
					<div className="max-w-sm rounded-lg border border-line bg-panel/95 p-5 text-center shadow-xl">
						<div className="mb-1 text-base font-semibold text-white">Let's light something up</div>
						<p className="mb-3 text-muted">This picture shows what your lights are doing. You don't have any lights yet.</p>
						<div className="flex flex-col gap-2">
							<button className="rounded bg-accent px-3 py-2 font-medium text-black hover:opacity-90" onClick={() => addFixture("par7")}>
								Add my first light
							</button>
							<button className="rounded border border-line bg-panel2 px-3 py-2 hover:bg-line" onClick={() => setHelpOpen(true)}>
								How does this work?
							</button>
						</div>
					</div>
				</div>
			)}

			<div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1">
				<button className={btn(view === "2d")} onClick={() => setView("2d")}>
					2D
				</button>
				<button className={btn(view === "3d")} onClick={() => setView("3d")}>
					3D
				</button>
				{view === "3d" && (
					<>
						<span className="mx-1 h-4 w-px bg-line" />
						<button className={btn(tool === "translate")} onClick={() => setTool("translate")} title="Move the selected light (W)">
							Move
						</button>
						<button className={btn(tool === "rotate")} onClick={() => setTool("rotate")} title="Rotate the selected light (E)">
							Rotate
						</button>
						<button className={btn(snap)} onClick={() => setSnap(!snap)} title="Snap moves to 25 cm and turns to 15°">
							Snap
						</button>
						<button className={btn(false)} onClick={() => setFrameTick((t) => t + 1)} title="Frame the selected light, or the whole stage (F)">
							Frame
						</button>
						<span className="mx-1 h-4 w-px bg-line" />
						{stage && stageStatus !== "error" ? (
							<button className={btn(false)} disabled={stageStatus === "loading"} onClick={removeStage} title="Take the stage out of the scene">
								{stageStatus === "loading" ? "Loading stage…" : "Remove stage"}
							</button>
						) : (
							<button className={btn(false)} onClick={loadStage} title="Load the demo stage (a truss rig, deck and speakers)">
								Load demo stage
							</button>
						)}
						<label className="flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white" title="Work lights: slide down for a dark concert look">
							Room light
							<input type="range" min={0} max={2} step={0.05} value={ambient} className="w-20" onChange={(e) => setAmbient(Number(e.target.value))} />
						</label>
					</>
				)}
			</div>

			{view === "3d" && stageStatus === "loading" && (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
					<div className="rounded bg-black/70 px-4 py-2 text-white">Loading the stage… this takes a few seconds</div>
				</div>
			)}
			{view === "3d" && stageStatus === "error" && (
				<div className="absolute inset-x-0 top-12 z-10 mx-auto w-fit max-w-md rounded bg-red-950/90 px-4 py-2 text-center text-sm text-red-100">
					{stageError || "The stage couldn't be loaded."}{" "}
					<button className="underline" onClick={loadStage}>
						Try again
					</button>
				</div>
			)}

			{view === "3d" && (
				<div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/60 px-2 py-1 text-[11px] text-muted">
					{hasLights
						? "Click a light, then drag the arrows · Left-drag orbit · Right-drag pan · Wheel zoom · W move · E rotate · F frame"
						: "Add a light from the Fixtures tab"}
				</div>
			)}
		</div>
	)
}
