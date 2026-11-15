import { useCallback, useEffect, useRef, useState } from "react"

import type { DisplayInfo } from "../global"
import type { Pt, ProjLayer, ProjSource } from "../lib/projection"

import {
	MAX_FEATHER,
	MAX_LAYERS,
	MAX_SOURCES,
	addMaskPoint,
	applyMat3,
	closeMask,
	insertMaskPoint,
	isConvexQuad,
	newLayer,
	placeSource as placeSourceOnto,
	rectQuad,
	removeMaskPoint,
	setCorner,
	setMaskPoint,
	squareToQuad,
	withLayer,
} from "../lib/projection"
import { ProjectionRenderer } from "../lib/projectionRenderer"
import { useStore } from "../lib/store"

type Tool = "warp" | "mask"
type Drag = { kind: "corner" | "vertex"; i: number }

const CLOSE_RADIUS = 14
let idCounter = 1
const nextId = (p: string): string => `${p}${Date.now()}${idCounter++}`
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

const btn = "rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** The projection mapper: sources and layers on the left, the live editor in the middle, the selected layer on the right. */
export function ProjectionView({ className = "" }: { className?: string }): React.JSX.Element {
	const projection = useStore((s) => s.projection)
	const selectedId = useStore((s) => s.selectedLayerId)
	const edit = useStore((s) => s.editProjection)
	const select = useStore((s) => s.selectLayer)

	const [tool, setTool] = useState<Tool>("warp")
	const [perform, setPerform] = useState(false)
	const [grid, setGrid] = useState(true)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [cams, setCams] = useState<{ deviceId: string; label: string }[] | null>(null)
	const [notice, setNotice] = useState("")
	const [displays, setDisplays] = useState<DisplayInfo[]>([])
	const [displayId, setDisplayId] = useState<number | null>(null)
	const [outputOpen, setOutputOpen] = useState(false)

	const layer = projection.layers.find((l) => l.id === selectedId) ?? null

	// the getting-started checklist is worked out from what's in the setup
	const defaultQuad = rectQuad()
	const sameQuad = (a: ProjLayer["corners"]): boolean => a.every((c, i) => Math.abs(c[0] - defaultQuad[i][0]) < 1e-6 && Math.abs(c[1] - defaultQuad[i][1]) < 1e-6)

	// ---------- the live preview ----------
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const boxRef = useRef<HTMLDivElement>(null)
	const svgRef = useRef<SVGSVGElement>(null)
	const rendererRef = useRef<ProjectionRenderer | null>(null)
	const [size, setSize] = useState({ w: 640, h: 360 })
	const [glError, setGlError] = useState("")

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		try {
			const r = new ProjectionRenderer(canvas)
			r.onSourceError = (id, message) => setErrors((e) => ({ ...e, [id]: message }))
			r.setScene(useStore.getState().projection)
			r.start()
			rendererRef.current = r
		} catch (err) {
			setGlError(err instanceof Error ? err.message : String(err))
		}
		return () => {
			rendererRef.current?.dispose()
			rendererRef.current = null
		}
	}, [])

	useEffect(() => {
		rendererRef.current?.setScene(projection)
		// a source that has been replaced or removed no longer has an error
		setErrors((e) => {
			const keep = Object.fromEntries(Object.entries(e).filter(([id]) => projection.sources.some((s) => s.id === id)))
			return Object.keys(keep).length === Object.keys(e).length ? e : keep
		})
	}, [projection])

	// fit the picture's aspect ratio into the space available
	useEffect(() => {
		const box = boxRef.current
		if (!box) return
		const fit = (): void => {
			// the box has 12px of padding all round; the picture fits inside that
			const aw = Math.max(1, box.clientWidth - 24)
			const ah = Math.max(1, box.clientHeight - 24)
			const aspect = projection.width / projection.height
			const w = Math.max(80, Math.min(aw, ah * aspect))
			setSize({ w: Math.floor(w), h: Math.floor(w / aspect) })
		}
		fit()
		const ro = new ResizeObserver(fit)
		ro.observe(box)
		return () => ro.disconnect()
	}, [projection.width, projection.height])

	// ---------- the output window ----------
	useEffect(() => {
		void window.studio?.projectionDisplays().then((d) => {
			setDisplays(d)
			// default to a screen that isn't the main one, since that's where a projector is
			setDisplayId((cur) => cur ?? (d.find((x) => !x.label.endsWith("(main)")) ?? d[0])?.id ?? null)
		})
		return window.studio?.onProjectionStatus(setOutputOpen)
	}, [])

	const refreshDisplays = (): void => {
		void window.studio?.projectionDisplays().then(setDisplays)
	}

	const popOut = async (): Promise<void> => {
		if (displayId === null || !window.studio) return
		const d = displays.find((x) => x.id === displayId)
		// the picture takes the projector's shape so nothing is stretched
		if (d && (d.width !== projection.width || d.height !== projection.height)) {
			edit((p) => ({ ...p, width: d.width, height: d.height }))
		}
		const ok = await window.studio.projectionOpen(displayId)
		if (!ok) setNotice("That display isn't connected any more. Press Refresh.")
		else setNotice("")
	}

	// ---------- sources ----------
	/**
	 * A new source goes straight onto a picture so something shows at once: the selected picture if it has no
	 * source yet, otherwise a fresh picture when there isn't one at all. One undo step either way.
	 */
	const placeSource = (src: ProjSource): void => {
		const newId = nextId("lyr")
		const { projection: next, placed } = placeSourceOnto(projection, src, selectedId, newId)
		edit(() => next)
		if (placed === "new") {
			select(newId)
			setTool("warp")
		}
	}

	const addVideo = async (): Promise<void> => {
		const path = await window.studio?.openVideo()
		if (!path) return
		if (projection.sources.length >= MAX_SOURCES) return setNotice(`Up to ${MAX_SOURCES} sources.`)
		setNotice("")
		placeSource({ id: nextId("src"), kind: "video", name: baseName(path), path })
	}

	const addCamera = async (): Promise<void> => {
		setNotice("")
		try {
			// the camera names stay blank until the app has been allowed to use one, so ask once, then let go
			const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
			for (const t of probe.getTracks()) t.stop()
			const all = await navigator.mediaDevices.enumerateDevices()
			const list = all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
			if (!list.length) return setNotice("No camera found.")
			setCams(list)
		} catch {
			setNotice("Couldn't open a camera. Check that nothing else is using it and that Windows allows camera access.")
		}
	}

	const chooseCamera = (c: { deviceId: string; label: string }): void => {
		setCams(null)
		if (projection.sources.length >= MAX_SOURCES) return setNotice(`Up to ${MAX_SOURCES} sources.`)
		placeSource({ id: nextId("src"), kind: "camera", name: c.label, deviceId: c.deviceId })
	}

	const removeSource = (id: string): void =>
		edit((p) => ({
			...p,
			sources: p.sources.filter((s) => s.id !== id),
			layers: p.layers.map((l) => (l.sourceId === id ? { ...l, sourceId: null } : l)),
		}))

	// ---------- layers ----------
	const addLayer = (mode: "add" | "hole"): void => {
		if (projection.layers.length >= MAX_LAYERS) return setNotice(`Up to ${MAX_LAYERS} layers.`)
		setNotice("")
		const id = nextId("lyr")
		const n = projection.layers.filter((l) => l.mode === mode).length + 1
		const l = newLayer(id, mode === "add" ? `Picture ${n}` : `Hidden area ${n}`, mode, mode === "add" ? (projection.sources[0]?.id ?? null) : null)
		edit((p) => ({ ...p, layers: [...p.layers, l] }))
		select(id)
		setTool(mode === "hole" ? "mask" : "warp")
	}

	const removeLayer = (id: string): void => {
		edit((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== id) }))
		if (selectedId === id) select(null)
	}

	const moveLayer = (id: string, dir: -1 | 1): void =>
		edit((p) => {
			const i = p.layers.findIndex((l) => l.id === id)
			const j = i + dir
			if (i < 0 || j < 0 || j >= p.layers.length) return p
			const layers = p.layers.slice()
			;[layers[i], layers[j]] = [layers[j], layers[i]]
			return { ...p, layers }
		})

	const patchLayer = (fn: (l: ProjLayer) => ProjLayer): void => {
		if (layer) edit((p) => withLayer(p, layer.id, fn))
	}

	// ---------- pointer editing ----------
	const drag = useRef<Drag | null>(null)

	const toNorm = (e: { clientX: number; clientY: number }): Pt => {
		const r = (svgRef.current as SVGSVGElement).getBoundingClientRect()
		return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
	}

	const startDrag = (e: React.PointerEvent, d: Drag): void => {
		e.stopPropagation()
		svgRef.current?.setPointerCapture(e.pointerId)
		drag.current = d
	}

	const onMove = (e: React.PointerEvent): void => {
		const d = drag.current
		if (!d || !layer) return
		const pt = toNorm(e)
		patchLayer((l) => (d.kind === "corner" ? setCorner(l, d.i, pt) : setMaskPoint(l, d.i, pt)))
	}

	const onUp = (e: React.PointerEvent): void => {
		if (drag.current) svgRef.current?.releasePointerCapture(e.pointerId)
		drag.current = null
	}

	/** a click on empty picture: while drawing a mask it adds a vertex, and clicking the first one closes the shape */
	const onBackground = (e: React.PointerEvent): void => {
		if (!layer || tool !== "mask" || layer.closed) return
		const pt = toNorm(e)
		if (layer.mask.length >= 3) {
			const first = layer.mask[0]
			if (Math.hypot((first[0] - pt[0]) * size.w, (first[1] - pt[1]) * size.h) < CLOSE_RADIUS) {
				patchLayer(closeMask)
				return
			}
		}
		patchLayer((l) => addMaskPoint(l, pt))
	}

	// Esc leaves performance mode
	useEffect(() => {
		if (!perform) return
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setPerform(false)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [perform])

	const px = useCallback((p: Pt): [number, number] => [p[0] * size.w, p[1] * size.h], [size])
	const pathOf = (pts: Pt[], close: boolean): string => pts.map((p, i) => `${i ? "L" : "M"}${px(p)[0]},${px(p)[1]}`).join(" ") + (close ? " Z" : "")

	// ---------- drawing the overlay ----------
	const overlay = (): React.JSX.Element | null => {
		if (perform) return null
		const gridLines: React.JSX.Element[] = []
		if (grid) {
			for (let i = 1; i < 10; i++) {
				const x = (i / 10) * size.w
				const y = (i / 10) * size.h
				const major = i === 5
				gridLines.push(<line key={`v${i}`} x1={x} y1={0} x2={x} y2={size.h} stroke="white" strokeOpacity={major ? 0.3 : 0.14} />)
				gridLines.push(<line key={`h${i}`} x1={0} y1={y} x2={size.w} y2={y} stroke="white" strokeOpacity={major ? 0.3 : 0.14} />)
			}
		}
		const others = projection.layers.filter((l) => l.id !== selectedId)
		return (
			<>
				{gridLines}
				{others.map((l) => (
					<g key={l.id}>
						<path d={pathOf([...l.corners], true)} fill="none" stroke={l.mode === "hole" ? "#f87171" : "#22d3c5"} strokeOpacity={0.35} strokeDasharray="4 4" pointerEvents="none" />
						{/* only the outline selects it, so clicks inside it still reach the layer being edited */}
						<path d={pathOf([...l.corners], true)} fill="none" stroke="transparent" strokeWidth={10} pointerEvents="stroke" style={{ cursor: "pointer" }} onPointerDown={(e) => (e.stopPropagation(), select(l.id))} />
					</g>
				))}
				{layer && tool === "warp" && warpOverlay(layer)}
				{layer && tool === "mask" && maskOverlay(layer)}
			</>
		)
	}

	const color = (l: ProjLayer): string => (l.mode === "hole" ? "#f87171" : "#22d3c5")

	const warpOverlay = (l: ProjLayer): React.JSX.Element => {
		const ok = isConvexQuad(l.corners)
		const m = ok ? squareToQuad(l.corners) : null
		const lines: React.JSX.Element[] = []
		if (m) {
			// the grid inside the quad follows the warp, so the perspective is visible while you pull the corners
			for (let k = 1; k < 4; k++) {
				const t = k / 4
				const a = [applyMat3(m, [t, 0]), applyMat3(m, [t, 1]), applyMat3(m, [0, t]), applyMat3(m, [1, t])]
				lines.push(<path key={`u${k}`} d={pathOf([a[0], a[1]], false)} stroke={color(l)} strokeOpacity={0.4} fill="none" />)
				lines.push(<path key={`w${k}`} d={pathOf([a[2], a[3]], false)} stroke={color(l)} strokeOpacity={0.4} fill="none" />)
			}
		}
		return (
			<g>
				<path d={pathOf([...l.corners], true)} fill={color(l)} fillOpacity={0.06} stroke={ok ? color(l) : "#f87171"} strokeWidth={1.5} pointerEvents="none" />
				{lines}
				{l.corners.map((c, i) => {
					const [x, y] = px(c)
					return (
						<g key={i} onPointerDown={(e) => startDrag(e, { kind: "corner", i })} style={{ cursor: "move" }}>
							<circle cx={x} cy={y} r={14} fill="transparent" />
							<rect x={x - 6} y={y - 6} width={12} height={12} fill="#141416" stroke={color(l)} strokeWidth={2} />
							<text x={x + 10} y={y - 8} fontSize={10} fill="white" opacity={0.7} pointerEvents="none">
								{["TL", "TR", "BR", "BL"][i]}
							</text>
						</g>
					)
				})}
			</g>
		)
	}

	const maskOverlay = (l: ProjLayer): React.JSX.Element => (
		<g>
			{l.mask.length >= 2 && (
				<path d={pathOf(l.mask, l.closed)} fill={l.closed ? color(l) : "none"} fillOpacity={0.12} stroke={color(l)} strokeWidth={1.5} pointerEvents="none" />
			)}
			{l.closed &&
				l.mask.map((p, i) => {
					const q = l.mask[(i + 1) % l.mask.length]
					const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
					const [x, y] = px(mid)
					return (
						<g
							key={`m${i}`}
							onPointerDown={(e) => {
								// a new vertex on this edge, picked up straight away so it can be dragged into place
								e.stopPropagation()
								patchLayer((x2) => insertMaskPoint(x2, i, mid))
								startDrag(e, { kind: "vertex", i: i + 1 })
							}}
							style={{ cursor: "copy" }}
						>
							<circle cx={x} cy={y} r={8} fill="transparent" />
							<circle cx={x} cy={y} r={3.5} fill={color(l)} fillOpacity={0.5} />
						</g>
					)
				})}
			{l.mask.map((p, i) => {
				const [x, y] = px(p)
				const closing = !l.closed && i === 0 && l.mask.length >= 3
				return (
					<g
						key={i}
						onPointerDown={(e) => {
							if (closing) {
								e.stopPropagation()
								patchLayer(closeMask)
								return
							}
							startDrag(e, { kind: "vertex", i })
						}}
						onContextMenu={(e) => {
							e.preventDefault()
							patchLayer((x2) => removeMaskPoint(x2, i))
						}}
						style={{ cursor: closing ? "pointer" : "move" }}
					>
						<circle cx={x} cy={y} r={14} fill="transparent" />
						<circle cx={x} cy={y} r={closing ? 7 : 5} fill="#141416" stroke={closing ? "#fbbf24" : color(l)} strokeWidth={2} />
					</g>
				)
			})}
		</g>
	)

	// ---------- layout ----------
	const sourceName = (id: string | null): string => projection.sources.find((s) => s.id === id)?.name ?? "No source"

	return (
		<div className={`grid min-h-0 grid-cols-[minmax(200px,300px)_minmax(0,1fr)_minmax(220px,320px)] gap-px ${className}`}>
			{/* left: sources and layers */}
			<aside className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-panel p-3">
				<Checklist
					steps={[
						{ label: "Add a video or camera", done: projection.sources.length > 0 },
						{ label: "Show it on a picture", done: projection.layers.some((l) => l.mode === "add" && !!l.sourceId) },
						{ label: "Drag the corners to fit your wall", done: projection.layers.some((l) => l.mode === "add" && !sameQuad(l.corners)) },
						{ label: "Send it to the projector", done: outputOpen },
					]}
				/>
				<section>
					<div className="mb-1 text-xs uppercase tracking-wide text-muted">Videos and cameras</div>
					<div className="mb-2 flex gap-1">
						<button className={btn} onClick={() => void addVideo()}>
							+ Video
						</button>
						<button className={btn} onClick={() => void addCamera()} title="Show a live camera or capture card">
							+ Live camera
						</button>
					</div>
					{cams && (
						<div className="mb-2 rounded border border-line bg-panel2 p-2">
							<div className="mb-1 text-muted">Which camera?</div>
							{cams.map((c) => (
								<button key={c.deviceId} className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-line" onClick={() => chooseCamera(c)}>
									{c.label}
								</button>
							))}
							<button className="mt-1 text-muted hover:text-white" onClick={() => setCams(null)}>
								Cancel
							</button>
						</div>
					)}
					{projection.sources.length === 0 && <div className="text-muted">Add a video file or a live camera. It shows up as a picture you can place on a wall.</div>}
					{projection.sources.map((s) => (
						<div key={s.id} className="mb-1 rounded border border-line bg-panel2 px-2 py-1">
							<div className="flex items-center gap-2">
								<span className="text-muted">{s.kind === "camera" ? "●" : "▶"}</span>
								<span className="min-w-0 flex-1 truncate" title={s.path ?? s.name}>
									{s.name}
								</span>
								<button className="text-muted hover:text-red-400" onClick={() => removeSource(s.id)} title="Remove this source">
									✕
								</button>
							</div>
							{errors[s.id] && <div className="mt-1 text-red-400">{errors[s.id]}</div>}
						</div>
					))}
				</section>

				<section>
					<div className="mb-1 text-xs uppercase tracking-wide text-muted">Pictures</div>
					<div className="mb-2 flex gap-1">
						<button className={btn} onClick={() => addLayer("add")} title="Another picture, placed on its own surface">
							+ Picture
						</button>
						<button className={btn} onClick={() => addLayer("hole")} title="Draw a shape where you want NO video, like a door or a person">
							+ Hide an area
						</button>
					</div>
					{projection.layers.length === 0 && <div className="text-muted">Each picture is one video placed on one surface. Pictures higher in the list draw on top.</div>}
					{[...projection.layers].reverse().map((l) => (
						<div
							key={l.id}
							onClick={() => select(l.id)}
							className={`mb-1 flex cursor-pointer items-center gap-1 rounded border px-2 py-1 ${l.id === selectedId ? "border-accent bg-panel2" : "border-line hover:bg-panel2"}`}
						>
							<span className={`rounded px-1 text-[10px] font-medium ${l.mode === "hole" ? "bg-red-400/20 text-red-300" : "bg-accent/20 text-accent"}`}>
								{l.mode === "hole" ? "HIDE" : "SHOW"}
							</span>
							<span className="min-w-0 flex-1 truncate">{l.name}</span>
							<button className="px-1 text-muted hover:text-white" title="Bring forward (draws on top)" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, 1))}>
								↑
							</button>
							<button className="px-1 text-muted hover:text-white" title="Send back" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, -1))}>
								↓
							</button>
							<button className="px-1 text-muted hover:text-red-400" title="Delete this picture" onClick={(e) => (e.stopPropagation(), removeLayer(l.id))}>
								✕
							</button>
						</div>
					))}
				</section>
			</aside>

			{/* middle: the live picture */}
			<div className="flex min-h-0 min-w-0 flex-col bg-bg">
				<div className="flex flex-wrap items-center gap-2 bg-panel px-3 py-2">
					<div className="flex overflow-hidden rounded border border-line">
						{(["warp", "mask"] as const).map((t) => (
							<button key={t} className={`px-3 py-1 ${tool === t ? "bg-accent font-medium text-black" : "bg-panel2 hover:bg-line"}`} onClick={() => setTool(t)} disabled={perform}>
								{t === "warp" ? "Fit to surface" : "Cut-out shape"}
							</button>
						))}
					</div>
					<label className="flex items-center gap-1 text-muted">
						<input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
						Grid
					</label>
					<div className="flex-1" />
					<button className={perform ? "rounded bg-accent px-3 py-1 font-medium text-black" : btn} onClick={() => setPerform((v) => !v)} title="Hide every handle and line, to see exactly what the projector shows. Press Esc to come back.">
						{perform ? "Clean view (Esc to edit)" : "Clean view"}
					</button>
				</div>
				<div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center p-3">
					{glError ? (
						<div className="text-red-400">Can't draw the preview: {glError}</div>
					) : (
						<div className="relative bg-black" style={{ width: size.w, height: size.h, cursor: perform ? "none" : "default" }}>
							<canvas ref={canvasRef} className="block h-full w-full" />
							{projection.sources.length === 0 && projection.layers.length === 0 && !perform && (
								<div className="absolute inset-0 z-10 flex items-center justify-center p-4">
									<div className="max-w-sm rounded-lg border border-line bg-panel/95 p-5 text-center shadow-xl">
										<div className="mb-1 text-base font-semibold text-white">Put a video on a wall</div>
										<p className="mb-3 text-muted">Pick a video (or a live camera). It shows up here, and you can then bend it to fit any surface.</p>
										<div className="flex flex-col gap-2">
											<button className="rounded bg-accent px-3 py-2 font-medium text-black hover:opacity-90" onClick={() => void addVideo()}>
												Choose a video file
											</button>
											<button className="rounded border border-line bg-panel2 px-3 py-2 hover:bg-line" onClick={() => void addCamera()}>
												Use a live camera
											</button>
										</div>
									</div>
								</div>
							)}
							{!perform && (
								<svg ref={svgRef} className="absolute inset-0 h-full w-full overflow-hidden" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" onPointerDown={onBackground} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: "none", cursor: tool === "mask" && layer && !layer.closed ? "crosshair" : "default" }}>
									{overlay()}
								</svg>
							)}
						</div>
					)}
				</div>
				<div className="min-h-[1.5rem] px-3 pb-2 text-muted">
					{notice ||
						(perform
							? "This is exactly what the projector shows."
							: !layer
								? (projection.layers.length === 0 ? "Add a video to get started." : "Click a picture in the list to edit it.")
								: tool === "warp"
									? "Drag the four square handles onto the corners of your wall or object. The grid shows how the picture bends."
									: layer.closed
										? "Drag a point to move it. Click a small dot on an edge to add a point. Right-click a point to remove it."
										: layer.mask.length < 3
											? "Click on the picture to outline the area you want. Place at least 3 points."
											: "Keep clicking to add points. Click the yellow first point (or Close shape) to finish.")}
				</div>
			</div>

			{/* right: the layer and the output */}
			<aside className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-panel p-3">
				<section>
					<div className="mb-1 text-xs uppercase tracking-wide text-muted">Selected picture</div>
					{!layer ? (
						<div className="text-muted">Click a picture in the list to change it.</div>
					) : (
						<div className="flex flex-col gap-2">
							<input className="rounded border border-line bg-panel2 px-2 py-1" value={layer.name} onChange={(e) => patchLayer((l) => ({ ...l, name: e.target.value.slice(0, 80) }))} />
							<div className="flex overflow-hidden rounded border border-line">
								{(["add", "hole"] as const).map((m) => (
									<button key={m} className={`flex-1 px-2 py-1 ${layer.mode === m ? "bg-accent font-medium text-black" : "bg-panel2 hover:bg-line"}`} onClick={() => patchLayer((l) => ({ ...l, mode: m }))} title={m === "add" ? "Shows the video inside the cut-out shape" : "Blocks all video beneath it inside the shape"}>
										{m === "add" ? "Show video" : "Hide area"}
									</button>
								))}
							</div>
							{layer.mode === "add" && (
								<label className="flex flex-col gap-1">
									<span className="text-muted">Video to show</span>
									<select className="rounded border border-line bg-panel2 px-2 py-1" value={layer.sourceId ?? ""} onChange={(e) => patchLayer((l) => ({ ...l, sourceId: e.target.value || null }))}>
										<option value="">{sourceName(null)}</option>
										{projection.sources.map((s) => (
											<option key={s.id} value={s.id}>
												{s.name}
											</option>
										))}
									</select>
								</label>
							)}
							<label className="flex flex-col gap-1">
								<span className="flex justify-between text-muted">
									<span title="Blurs the edge of the cut-out so it blends in, instead of a hard line">Soft edges</span>
									<span>{Math.round(layer.feather)} px</span>
								</span>
								<input type="range" min={0} max={MAX_FEATHER} value={layer.feather} onChange={(e) => patchLayer((l) => ({ ...l, feather: Number(e.target.value) }))} />
							</label>
							<div className="flex flex-wrap gap-1">
								<button className={btn} onClick={() => patchLayer((l) => ({ ...l, corners: rectQuad() }))} title="Put the four corners back to a plain rectangle">
									Reset corners
								</button>
								<button className={btn} disabled={layer.closed || layer.mask.length < 3} onClick={() => patchLayer(closeMask)}>
									Close shape
								</button>
								<button className={btn} onClick={() => patchLayer((l) => ({ ...l, mask: l.corners.map((c): Pt => [c[0], c[1]]), closed: true }))} title="Make the cut-out the same shape as the whole picture">
									Cut-out = whole picture
								</button>
								<button className={btn} onClick={() => patchLayer((l) => ({ ...l, mask: [], closed: false }))} title="Delete the cut-out and start drawing it again">
									Clear cut-out
								</button>
							</div>
							{!isConvexQuad(layer.corners) && <div className="text-red-400">The corners are crossed over, so this picture is hidden. Drag them back into a normal four-sided shape.</div>}
							{layer.mode === "add" && !layer.sourceId && <div className="text-muted">No video chosen yet, so nothing shows. Pick one above.</div>}
						</div>
					)}
				</section>

				<section>
					<div className="mb-1 text-xs uppercase tracking-wide text-muted">Send to projector</div>
					{displays.length === 0 ? (
						<div className="text-muted">Sending to a projector needs the desktop app.</div>
					) : (
						<div className="flex flex-col gap-2">
							<select className="rounded border border-line bg-panel2 px-2 py-1" value={displayId ?? ""} onChange={(e) => setDisplayId(Number(e.target.value))} disabled={outputOpen}>
								{displays.map((d) => (
									<option key={d.id} value={d.id}>
										{d.label} · {d.width}×{d.height}
									</option>
								))}
							</select>
							<div className="flex gap-1">
								{outputOpen ? (
									<button className="rounded bg-red-500 px-3 py-1 font-medium text-white" onClick={() => void window.studio?.projectionClose()}>
										Stop sending
									</button>
								) : (
									<button className="rounded bg-accent px-3 py-1 font-medium text-black" onClick={() => void popOut()}>
										Send to projector
									</button>
								)}
								<button className={btn} onClick={refreshDisplays} disabled={outputOpen}>
									Refresh
								</button>
							</div>
							<div className="text-muted">
								{outputOpen ? "Live on the projector. Press Esc on that screen to stop." : "Pick the screen your projector is plugged into. Its picture appears there, full screen."}
							</div>
							{displays.length === 1 && !outputOpen && <div className="text-muted">Only one screen is connected, so the picture will cover it. Press Esc to get back here.</div>}
						</div>
					)}
				</section>
			</aside>
		</div>
	)
}

/** A short "what to do next" list: done steps get a tick, and the first step still to do is highlighted. */
function Checklist({ steps }: { steps: { label: string; done: boolean }[] }): React.JSX.Element {
	const next = steps.findIndex((x) => !x.done)
	return (
		<section className="rounded border border-line bg-panel2 p-3">
			<div className="mb-2 text-xs uppercase tracking-wide text-muted">{next === -1 ? "All set" : "Getting started"}</div>
			<ol className="space-y-1.5">
				{steps.map((st, i) => (
					<li key={st.label} className={`flex items-start gap-2 ${st.done ? "text-muted" : i === next ? "font-medium text-white" : "text-muted"}`}>
						<span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${st.done ? "bg-accent text-black" : i === next ? "border border-accent text-accent" : "border border-line"}`}>
							{st.done ? "✓" : i + 1}
						</span>
						<span className={st.done ? "line-through decoration-line" : ""}>{st.label}</span>
					</li>
				))}
			</ol>
		</section>
	)
}
