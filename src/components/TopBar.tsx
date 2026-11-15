import { useCallback, useEffect, useState } from "react"

import type { DmxPortInfo, DmxStatus } from "../global"

import { newProject, openProject, saveProjectAs } from "../lib/project"
import { useStore } from "../lib/store"

export function TopBar(): React.JSX.Element {
	const [saved, setSaved] = useState(false)
	const blackout = useStore((s) => s.blackout)
	const setBlackout = useStore((s) => s.setBlackout)
	const testLights = useStore((s) => s.testLights)
	const setTestLights = useStore((s) => s.setTestLights)
	const mode = useStore((s) => s.mode)
	const setMode = useStore((s) => s.setMode)
	const workspace = useStore((s) => s.workspace)
	const setWorkspace = useStore((s) => s.setWorkspace)
	const setHelpOpen = useStore((s) => s.setHelpOpen)
	const [ports, setPorts] = useState<DmxPortInfo[]>([])
	const [port, setPort] = useState("")
	const [status, setStatus] = useState<DmxStatus>({ state: "disconnected" })
	const [error, setError] = useState("")
	const hasBridge = typeof window !== "undefined" && !!window.dmx

	const refresh = useCallback(async () => {
		if (!window.dmx) return
		const list = await window.dmx.list()
		setPorts(list)
		setPort((cur) => cur || list[0]?.path || "")
	}, [])

	useEffect(() => {
		void refresh()
		return window.dmx?.onStatus(setStatus)
	}, [refresh])

	const connected = status.state === "connected"

	const toggle = async (): Promise<void> => {
		if (!window.dmx) return
		setError("")
		if (connected) {
			await window.dmx.disconnect()
			return
		}
		const res = await window.dmx.connect(port)
		if (!res.ok) setError(res.error ?? "Could not open port")
	}

	return (
		<header className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 bg-panel px-3 py-1">
			<div className="font-semibold tracking-wide text-accent">DMX Studio</div>
			<div className="flex overflow-hidden rounded border border-line">
				{(["timeline", "cues", "projection"] as const).map((m) => {
					const active = m === "projection" ? workspace === "projection" : workspace === "show" && mode === m
					return (
						<button
							key={m}
							className={`px-3 py-1 ${active ? "bg-accent font-medium text-black" : "bg-panel2 hover:bg-line"}`}
							onClick={() => {
								if (m === "projection") {
									setWorkspace("projection")
									return
								}
								setWorkspace("show")
								// switching mode stops playback, so only do it when the mode actually changes
								if (mode !== m) setMode(m)
							}}
						>
							{m === "timeline" ? "Timeline" : m === "cues" ? "Cues" : "Projection"}
						</button>
					)
				})}
			</div>
			<div className="flex gap-1">
				<button className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line" onClick={newProject}>
					New
				</button>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line"
					onClick={() => void openProject()}
				>
					Open
				</button>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line"
					title="Your show is also autosaved, and comes back next time you open the app"
					onClick={() =>
						void saveProjectAs().then((ok) => {
							if (!ok) return
							setSaved(true)
							setTimeout(() => setSaved(false), 1500)
						})
					}
				>
					{saved ? "Saved ✓" : "Save as"}
				</button>
			</div>
			<button
				className="rounded border border-accent px-3 py-1 font-medium text-accent hover:bg-accent hover:text-black"
				title="A short guide to how everything works"
				onClick={() => setHelpOpen(true)}
			>
				? Help
			</button>
			<div className="flex-1" />
			{hasBridge ? (
				<>
					<select
						className="rounded border border-line bg-panel2 px-2 py-1"
						value={port}
						onChange={(e) => setPort(e.target.value)}
						disabled={connected}
					>
						{ports.length === 0 && <option value="">No COM ports found</option>}
						{ports.map((p) => (
							<option key={p.path} value={p.path}>
								{p.path}
								{p.vendorId ? ` (${p.vendorId}:${p.productId})` : ""}
							</option>
						))}
					</select>
					<button
						className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line"
						onClick={() => void refresh()}
						disabled={connected}
					>
						Refresh
					</button>
					<button
						className={`rounded px-3 py-1 font-medium ${connected ? "bg-line" : "bg-accent text-black"}`}
						onClick={() => void toggle()}
						disabled={!connected && !port}
					>
						{connected ? "Disconnect" : "Connect"}
					</button>
					<span className="min-w-0 max-w-72 truncate text-muted">
						{status.state === "connected" &&
							`● ${status.path} · ${status.fps ?? 0} fps · worst gap ${status.worstMs ?? 0} ms`}
						{status.state === "disconnected" && !error && "○ Not connected"}
						{status.state === "error" && <span className="text-red-400">{status.message}</span>}
						{error && <span className="text-red-400">{error}</span>}
					</span>
				</>
			) : (
				<span className="text-muted">Preview only (open in the desktop app to output DMX)</span>
			)}
			<button
				className={`rounded px-3 py-1 font-medium ${testLights ? "bg-amber-400 text-black" : "border border-line bg-panel2 hover:bg-line"}`}
				title="Wiring check: sends full white to every light, ignoring the timeline. If a light stays dark, it's the cable, address or mode. Press again (or Play) to stop."
				onClick={() => setTestLights(!testLights)}
			>
				{testLights ? "Test ON: all white" : "Test lights"}
			</button>
			<button
				className={`rounded px-3 py-1 font-medium ${blackout ? "bg-red-500 text-white" : "border border-line bg-panel2 hover:bg-line"}`}
				onClick={() => setBlackout(!blackout)}
			>
				{blackout ? "Blackout ON" : "Blackout"}
			</button>
		</header>
	)
}
