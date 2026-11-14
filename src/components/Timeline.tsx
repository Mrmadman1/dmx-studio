import { useEffect, useRef, useState } from "react"

import { addAudioFromPath, getLoaded, pickAudioFiles } from "../lib/audio"
import { loadReferenceFromPath } from "../lib/reference"
import { type Accent, type Clip, showEnd } from "../lib/show"
import { type AudioClip, type Reference, lightTime, mediaSpans, useStore } from "../lib/store"

const LABEL_W = 150
const RULER_H = 26
const TRACK_H = 46
const AUDIO_H = 72
const CLIP_H = TRACK_H - 8
const AUDIO_CLIP_H = AUDIO_H - 8
/** waveforms are drawn in tiles this wide so a long song at high zoom never exceeds canvas limits */
const TILE_W = 4096
const AUDIO_FILE = /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv)$/i
const VIDEO_H = 40
const ACCENT_H = 34
const ACCENT_COLOR = "255,176,46"

function fmt(t: number): string {
	const m = Math.floor(t / 60)
	return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`
}

/** Snap a time to the playhead, zero, every clip edge and every detected beat when close enough on screen. */
function snapTime(t: number, exclude?: string | string[]): number {
	const { clips, accents, audioClips, reference, playhead, snap, zoom } = useStore.getState()
	if (!snap) return t
	const skip = new Set(Array.isArray(exclude) ? exclude : exclude ? [exclude] : [])
	const points = [0, playhead]
	for (const c of clips) {
		if (!skip.has(c.id)) points.push(c.start, c.start + c.duration)
	}
	for (const a of audioClips) {
		if (!skip.has(a.id)) points.push(a.start, a.start + a.duration)
		for (const b of a.beats ?? []) points.push(a.start + b)
	}
	if (reference && !skip.has("video")) points.push(reference.start, reference.start + reference.duration)
	for (const a of accents) {
		if (!skip.has(a.id)) points.push(a.start, a.start + a.duration)
	}
	let best = t
	let bestDist = 8 / zoom
	for (const p of points) {
		const d = Math.abs(p - t)
		if (d < bestDist) {
			bestDist = d
			best = p
		}
	}
	return best
}

function startDrag(e: React.PointerEvent, onMove: (dx: number, ev: PointerEvent) => void): void {
	e.preventDefault()
	e.stopPropagation()
	const x0 = e.clientX
	const move = (ev: PointerEvent): void => onMove(ev.clientX - x0, ev)
	const up = (): void => {
		window.removeEventListener("pointermove", move)
		window.removeEventListener("pointerup", up)
	}
	window.addEventListener("pointermove", move)
	window.addEventListener("pointerup", up)
}

const itemStart = (id: string): number | undefined => {
	const s = useStore.getState()
	return (s.clips.find((c) => c.id === id) ?? s.accents.find((a) => a.id === id) ?? s.audioClips.find((a) => a.id === id))?.start
}
const itemDuration = (id: string): number => {
	const s = useStore.getState()
	return (s.clips.find((c) => c.id === id) ?? s.accents.find((a) => a.id === id) ?? s.audioClips.find((a) => a.id === id))?.duration ?? 0
}

/**
 * Press on a clip, accent or audio clip. Shift/Ctrl-click adds or removes it from the selection.
 * Otherwise it (or the whole selected group, if it's part of one) can be dragged; hold Alt to drag
 * copies instead.
 */
function itemPointerDown(e: React.PointerEvent, id: string): void {
	if (e.button !== 0) return
	const s = useStore.getState()
	if (e.shiftKey || e.ctrlKey || e.metaKey) {
		e.preventDefault()
		e.stopPropagation()
		s.toggleSelected(id)
		return
	}
	if (!s.selection.includes(id)) s.setSelection([id])
	startGroupDrag(e, id)
}

function startGroupDrag(e: React.PointerEvent, grabbedId: string): void {
	e.preventDefault()
	e.stopPropagation()
	const copy = e.altKey
	const x0 = e.clientX
	let ids = useStore.getState().selection.slice()
	let grabbed = grabbedId
	const initial: Record<string, number> = {}
	const record = (): void => {
		for (const k of Object.keys(initial)) delete initial[k]
		for (const id of ids) {
			const start = itemStart(id)
			if (start !== undefined) initial[id] = start
		}
	}
	record()
	let moved = false
	let copied = false

	const move = (ev: PointerEvent): void => {
		const dx = ev.clientX - x0
		if (!moved) {
			if (Math.abs(dx) < 3) return // a click shouldn't nudge anything
			moved = true
		}
		if (copy && !copied) {
			// leave the originals where they are and carry copies instead
			copied = true
			const map = useStore.getState().copySelectionInPlace(ids)
			grabbed = map[grabbedId] ?? grabbed
			ids = Object.values(map)
			record()
		}
		const s0 = initial[grabbed]
		if (s0 === undefined) return
		const dur = itemDuration(grabbed)
		const raw = s0 + dx / useStore.getState().zoom
		const a = snapTime(raw, ids)
		const b = snapTime(raw + dur, ids) - dur
		const target = Math.abs(a - raw) <= Math.abs(b - raw) ? a : b
		useStore.getState().moveSelection(initial, target - s0, !copy)
	}
	const up = (): void => {
		window.removeEventListener("pointermove", move)
		window.removeEventListener("pointerup", up)
		const s = useStore.getState()
		if (copied) s.settleClips(ids) // dropped copies that landed on clips get pushed clear
		else if (!moved && ids.length > 1) s.setSelection([grabbedId]) // plain click on one of a group: just that one
	}
	window.addEventListener("pointermove", move)
	window.addEventListener("pointerup", up)
}

export function Timeline(): React.JSX.Element {
	const fixtures = useStore((s) => s.fixtures)
	const clips = useStore((s) => s.clips)
	const audioClips = useStore((s) => s.audioClips)
	const reference = useStore((s) => s.reference)
	const accents = useStore((s) => s.accents)
	const selection = useStore((s) => s.selection)
	const hasClipboard = useStore((s) => s.clipboard !== null)
	const playhead = useStore((s) => s.playhead)
	const playing = useStore((s) => s.playing)
	const zoom = useStore((s) => s.zoom)
	const snapOn = useStore((s) => s.snap)
	const latencyMs = useStore((s) => s.latencyMs)
	const selectedClipId = useStore((s) => s.selectedClipId)
	const selectedId = useStore((s) => s.selectedId)
	const scroller = useRef<HTMLDivElement>(null)
	const inner = useRef<HTMLDivElement>(null)
	const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
	const [viewW, setViewW] = useState(0)

	// the ruler and tracks always fill the panel, however wide it is
	useEffect(() => {
		const el = scroller.current
		if (!el) return
		const ro = new ResizeObserver(() => setViewW(el.clientWidth))
		ro.observe(el)
		setViewW(el.clientWidth)
		return () => ro.disconnect()
	}, [])

	const end = showEnd(clips, mediaSpans({ audioClips, reference }))
	const contentW = Math.max(Math.max(end + 15, 30) * zoom, viewW - LABEL_W)

	// keep the playhead on screen while playing
	useEffect(() => {
		const el = scroller.current
		if (!playing || !el) return
		const x = playhead * zoom
		if (x > el.scrollLeft + el.clientWidth - LABEL_W - 40 || x < el.scrollLeft) {
			el.scrollLeft = Math.max(0, x - 120)
		}
	}, [playhead, playing, zoom])

	const step = zoom >= 120 ? 0.5 : zoom >= 40 ? 1 : zoom >= 20 ? 2 : 5
	const ticks: number[] = []
	for (let t = 0; t <= contentW / zoom; t += step) ticks.push(t)

	const st = useStore.getState
	const targetFixture = selectedId ?? fixtures[0]?.id
	const selected = new Set(selection)
	const hasSelection = selection.length > 0
	const hasClipSelected = clips.some((c) => selected.has(c.id))

	/** Press on empty timeline space: a plain click clears the selection; a drag draws a box and selects whatever it touches. */
	const startMarquee = (e: React.PointerEvent, onClick: () => void): void => {
		if (e.button !== 0) return
		const box = inner.current
		if (!box) return
		e.preventDefault()
		const x0 = e.clientX
		const y0 = e.clientY
		const additive = e.shiftKey || e.ctrlKey || e.metaKey
		const prior = additive ? st().selection.slice() : []
		let dragging = false
		const move = (ev: PointerEvent): void => {
			if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
			dragging = true
			const left = Math.min(x0, ev.clientX)
			const right = Math.max(x0, ev.clientX)
			const top = Math.min(y0, ev.clientY)
			const bottom = Math.max(y0, ev.clientY)
			const origin = box.getBoundingClientRect()
			setMarquee({ x: left - origin.left, y: top - origin.top, w: right - left, h: bottom - top })
			const hits = Array.from(box.querySelectorAll<HTMLElement>("[data-item-id]"))
				.filter((el) => {
					const r = el.getBoundingClientRect()
					return r.left < right && r.right > left && r.top < bottom && r.bottom > top
				})
				.map((el) => el.dataset.itemId as string)
			st().setSelection([...new Set([...prior, ...hits])])
		}
		const up = (): void => {
			window.removeEventListener("pointermove", move)
			window.removeEventListener("pointerup", up)
			setMarquee(null)
			if (!dragging && !additive) onClick()
		}
		window.addEventListener("pointermove", move)
		window.addEventListener("pointerup", up)
	}

	const timeAt = (clientX: number): number => {
		const el = scroller.current
		if (!el) return 0
		const r = el.getBoundingClientRect()
		return Math.max(0, (clientX - r.left + el.scrollLeft - LABEL_W) / st().zoom)
	}

	/** Move the playhead to the pointer, nudging the scroll when it's dragged to an edge. */
	const scrub = (clientX: number): void => {
		const el = scroller.current
		if (!el) return
		const r = el.getBoundingClientRect()
		if (clientX > r.right - 30) el.scrollLeft += 14
		else if (clientX < r.left + LABEL_W + 30) el.scrollLeft -= 14
		st().setPlayhead(timeAt(clientX))
	}
	const startScrub = (e: React.PointerEvent): void => {
		scrub(e.clientX)
		startDrag(e, (_dx, ev) => scrub(ev.clientX))
	}

	const dropFiles = (e: React.DragEvent): void => {
		e.preventDefault()
		const studio = window.studio
		if (!studio) return
		const dropAt = timeAt(e.clientX)
		const all = Array.from(e.dataTransfer.files).map((f) => studio.pathForFile(f))
		const video = all.find((p) => VIDEO_FILE.test(p))
		void (async () => {
			let at = dropAt
			for (const p of all.filter((x) => AUDIO_FILE.test(x))) at += await addAudioFromPath(p, at)
			if (video) await loadReferenceFromPath(video, dropAt)
		})()
	}

	const addAudio = async (): Promise<void> => {
		let at = st().playhead
		for (const p of await pickAudioFiles()) at += await addAudioFromPath(p, at)
	}

	return (
		<section
			className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
			onDragOver={(e) => {
				if (e.dataTransfer.types.includes("Files")) e.preventDefault()
			}}
			onDrop={dropFiles}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
				<button
					className="w-16 rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
					disabled={end === 0}
					onClick={() => st().togglePlay()}
				>
					{playing ? "Pause" : "Play"}
				</button>
				<span className="w-28 tabular-nums text-muted">
					<span className="text-white">{fmt(playhead)}</span> / {fmt(end)}
				</span>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
					disabled={!targetFixture}
					onClick={() => targetFixture && st().addClip(targetFixture, st().playhead)}
				>
					+ Clip
				</button>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line"
					onClick={() => st().addAccent(lightTime(st()))}
					title="Brighten the lights at the playhead for a moment (A). Tap A while the song plays to hit the beats live."
				>
					+ Accent
				</button>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line"
					onClick={() => void addAudio()}
					title="Add an MP3/WAV (or just drag one onto the timeline)"
				>
					+ Audio
				</button>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
					disabled={!hasClipSelected}
					onClick={() => st().splitSelection(st().playhead)}
					title="Split the selected clips at the playhead (S)"
				>
					Split
				</button>
				<span className="flex gap-1">
					<button
						className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
						disabled={!hasSelection}
						onClick={() => st().copySelection()}
						title="Copy everything selected (Ctrl+C)"
					>
						Copy
					</button>
					<button
						className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
						disabled={!hasClipboard}
						onClick={() => st().pasteClipboard()}
						title="Paste at the playhead, keeping the spacing. Clips go on the selected light's track (Ctrl+V)"
					>
						Paste
					</button>
					<button
						className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
						disabled={!hasSelection}
						onClick={() => st().duplicateSelection()}
						title="Copy the selection right after the original (Ctrl+D)"
					>
						Duplicate
					</button>
				</span>
				<button
					className="rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
					disabled={!hasSelection}
					onClick={() => st().deleteSelection()}
					title="Delete everything selected (Del)"
				>
					Delete
				</button>
				{selection.length > 1 && <span className="text-accent">{selection.length} selected</span>}
				<label className="flex items-center gap-1 text-muted">
					<input type="checkbox" checked={snapOn} onChange={(e) => st().setSnap(e.target.checked)} />
					Snap
				</label>
				<label
					className="flex items-center gap-1 text-muted"
					title="Bluetooth speakers play late. Raise this until the lights land with the sound."
				>
					Speaker delay
					<input
						type="range"
						min={-200}
						max={800}
						step={10}
						value={latencyMs}
						className="w-24"
						onChange={(e) => st().setLatencyMs(Number(e.target.value))}
					/>
					<span className="w-14 tabular-nums text-white">{latencyMs} ms</span>
				</label>
				<div className="flex-1" />
				<span className="text-muted">Zoom</span>
				<input
					type="range"
					min={15}
					max={300}
					value={zoom}
					className="w-32"
					onChange={(e) => st().setZoom(Number(e.target.value))}
				/>
			</div>

			<div ref={scroller} className="relative min-h-0 min-w-0 flex-1 overflow-auto">
				<div ref={inner} className="relative" style={{ width: LABEL_W + contentW, minHeight: "100%" }}>
					{/* ruler */}
					<div className="sticky top-0 z-40 flex bg-panel" style={{ height: RULER_H }}>
						<div
							className="sticky left-0 z-40 border-b border-r border-line bg-panel"
							style={{ width: LABEL_W, minWidth: LABEL_W }}
						/>
						<div
							className="relative cursor-pointer border-b border-line"
							style={{ width: contentW }}
							onPointerDown={startScrub}
						>
							{ticks.map((t) => (
								<div
									key={t}
									className="absolute bottom-0 border-l border-line pl-1 text-[10px] text-muted"
									style={{ left: t * zoom, height: Number.isInteger(t) ? 14 : 8 }}
								>
									{Number.isInteger(t) ? fmt(t).replace(/\.0$/, "") : ""}
								</div>
							))}
							{/* the playhead's handle: grab it (or the ruler) and drag anywhere */}
							<div
								className="absolute top-0 z-10 h-4 w-3.5 cursor-ew-resize rounded-b-md bg-red-500"
								style={{ left: playhead * zoom - 7 }}
								title="Drag the playhead"
								onPointerDown={startScrub}
							/>
						</div>
					</div>

					{/* audio track */}
					<div className="flex" style={{ height: AUDIO_H }}>
						<div
							className="sticky left-0 z-30 flex items-center border-b border-r border-line bg-panel px-2 text-[#4da3ff]"
							style={{ width: LABEL_W, minWidth: LABEL_W }}
						>
							♪ Audio
						</div>
						<div
							className="relative border-b border-line"
							style={{
								width: contentW,
								backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${zoom}px)`,
							}}
							onPointerDown={(e) => startMarquee(e, () => st().setSelection([]))}
						>
							{audioClips.length === 0 && (
								<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
									Drag an MP3 or WAV here, or click “+ Audio”
								</span>
							)}
							{audioClips.map((a) => (
								<AudioClipView key={a.id} clip={a} zoom={zoom} selected={selected.has(a.id)} />
							))}
						</div>
					</div>

					{/* reference video track */}
					{reference && (
						<div className="flex" style={{ height: VIDEO_H }}>
							<div
								className="sticky left-0 z-30 flex items-center border-b border-r border-line bg-panel px-2 text-[#b58cff]"
								style={{ width: LABEL_W, minWidth: LABEL_W }}
							>
								🎞 Video
							</div>
							<div
								className="relative border-b border-line"
								style={{
									width: contentW,
									backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${zoom}px)`,
								}}
							>
								<VideoClipView reference={reference} zoom={zoom} />
							</div>
						</div>
					)}

					{/* accent track: brightness bumps that sit on top of the light clips */}
					<div className="flex" style={{ height: ACCENT_H }}>
						<div
							className="sticky left-0 z-30 flex items-center border-b border-r border-line bg-panel px-2 text-[#ffb02e]"
							style={{ width: LABEL_W, minWidth: LABEL_W }}
						>
							✦ Accents
						</div>
						<div
							className="relative border-b border-line"
							style={{
								width: contentW,
								backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${zoom}px)`,
							}}
							onPointerDown={(e) => startMarquee(e, () => st().setSelection([]))}
							onDoubleClick={(e) => {
								const left = e.currentTarget.getBoundingClientRect().left
								st().addAccent((e.clientX - left) / zoom)
							}}
						>
							{accents.length === 0 && (
								<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
									Double-click here, or press A, to add a brightness boost
								</span>
							)}
							{accents.map((a) => (
								<AccentView key={a.id} accent={a} zoom={zoom} selected={selected.has(a.id)} />
							))}
						</div>
					</div>

					{/* light tracks */}
					{fixtures.length === 0 && (
						<div className="sticky left-0 p-4 text-muted">Add a light in the Fixtures tab to get a track.</div>
					)}
					{fixtures.map((f) => (
						<div key={f.id} className="flex" style={{ height: TRACK_H }}>
							<div
								className={`sticky left-0 z-30 flex items-center border-b border-r border-line px-2 ${f.id === selectedId ? "bg-panel2 text-accent" : "bg-panel"}`}
								style={{ width: LABEL_W, minWidth: LABEL_W }}
								onClick={() => st().selectFixture(f.id)}
							>
								<span className="truncate">{f.name}</span>
							</div>
							<div
								className="relative border-b border-line"
								style={{
									width: contentW,
									backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${zoom}px)`,
								}}
								onPointerDown={(e) =>
									startMarquee(e, () => {
										st().selectFixture(f.id)
										st().setSelection([])
									})
								}
								onDoubleClick={(e) => {
									const left = e.currentTarget.getBoundingClientRect().left
									st().addClip(f.id, (e.clientX - left) / zoom)
								}}
							>
								{clips
									.filter((c) => c.fixtureId === f.id)
									.map((c) => (
										<ClipView
											key={c.id}
											clip={c}
											zoom={zoom}
											selected={selected.has(c.id)}
											handles={c.id === selectedClipId}
										/>
									))}
							</div>
						</div>
					))}

					{/* playhead: a grab strip that sits under the clips, and the visible line on top */}
					<div
						className="absolute top-0 bottom-0 z-0 w-2 cursor-ew-resize"
						style={{ left: LABEL_W + playhead * zoom - 4 }}
						onPointerDown={startScrub}
					/>
					<div
						className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
						style={{ left: LABEL_W + playhead * zoom }}
					/>
					{marquee && (
						<div
							className="pointer-events-none absolute z-30 border border-accent bg-accent/10"
							style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
						/>
					)}
				</div>
			</div>
		</section>
	)
}

/** An accent point: drag to move, drag the edges to change how long it lasts. */
function AccentView({ accent, zoom, selected }: { accent: Accent; zoom: number; selected: boolean }): React.JSX.Element {
	const st = useStore.getState
	const h = ACCENT_H - 8
	const w = Math.max(10, accent.duration * zoom)
	const fiW = Math.min(w, accent.fadeIn * zoom)
	const foW = Math.min(w, accent.fadeOut * zoom)

	const move = (e: React.PointerEvent): void => itemPointerDown(e, accent.id)
	const trimL = (e: React.PointerEvent): void => {
		st().selectAccent(accent.id)
		const s0 = accent.start
		const end = accent.start + accent.duration
		startDrag(e, (dx) => {
			const ns = Math.max(0, Math.min(snapTime(s0 + dx / zoom, accent.id), end - 0.1))
			st().updateAccent(accent.id, { start: ns, duration: end - ns })
		})
	}
	const trimR = (e: React.PointerEvent): void => {
		st().selectAccent(accent.id)
		const e0 = accent.start + accent.duration
		startDrag(e, (dx) => {
			st().updateAccent(accent.id, { duration: snapTime(e0 + dx / zoom, accent.id) - accent.start })
		})
	}

	return (
		<div
			className="absolute top-1 z-[1] cursor-grab overflow-hidden rounded active:cursor-grabbing"
			style={{
				left: accent.start * zoom,
				width: w,
				height: h,
				background: `rgba(${ACCENT_COLOR},${0.4 + 0.6 * accent.amount})`,
				outline: selected ? "2px solid #fff" : "1px solid rgba(0,0,0,0.45)",
				outlineOffset: -1,
			}}
			title={`+${Math.round(accent.amount * 100)}% brightness`}
			data-item-id={accent.id}
			onPointerDown={move}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			<svg width={w} height={h} className="pointer-events-none absolute inset-0">
				{fiW > 0 && <polygon points={`0,0 ${fiW},0 0,${h}`} fill="rgba(0,0,0,0.5)" />}
				{foW > 0 && <polygon points={`${w},0 ${w - foW},0 ${w},${h}`} fill="rgba(0,0,0,0.5)" />}
			</svg>
			<span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[10px] font-bold text-black">
				+{Math.round(accent.amount * 100)}%
			</span>
			<div className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize" onPointerDown={trimL} />
			<div className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize" onPointerDown={trimR} />
		</div>
	)
}

/** The reference video's bar: drag it to line the footage up with the song. */
function VideoClipView({ reference, zoom }: { reference: Reference; zoom: number }): React.JSX.Element {
	const st = useStore.getState
	const move = (e: React.PointerEvent): void => {
		const s0 = reference.start
		startDrag(e, (dx) => {
			const raw = s0 + dx / zoom
			const a = snapTime(raw, "video")
			const b = snapTime(raw + reference.duration, "video") - reference.duration
			const start = Math.abs(a - raw) <= Math.abs(b - raw) ? a : b
			st().updateReference({ start: Math.max(1 - reference.duration, start) })
		})
	}
	return (
		<div
			className="absolute top-1 z-[1] flex cursor-grab items-center overflow-hidden rounded bg-[#3a2766] px-2 text-[11px] text-white active:cursor-grabbing"
			style={{
				left: reference.start * zoom,
				width: reference.duration * zoom,
				height: VIDEO_H - 8,
				outline: "1px solid rgba(181,140,255,0.6)",
				outlineOffset: -1,
			}}
			title="Drag to line the video up with the music"
			onPointerDown={move}
		>
			<span className="truncate">{reference.name}</span>
		</div>
	)
}

/** One tile of an audio clip's waveform. */
function WaveTile({ path, zoom, x0, width }: { path: string; zoom: number; x0: number; width: number }): React.JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null)
	useEffect(() => {
		const canvas = ref.current
		const loaded = getLoaded(path)
		const ctx = canvas?.getContext("2d")
		if (!canvas || !loaded || !ctx) return
		const { peaks, bucket, buffer } = loaded
		const perPx = (buffer.sampleRate / bucket) / zoom // buckets per pixel
		const buckets = peaks.length / 2
		const mid = AUDIO_CLIP_H / 2
		const amp = mid - 3
		ctx.clearRect(0, 0, width, AUDIO_CLIP_H)
		ctx.fillStyle = "#4da3ff"
		for (let i = 0; i < width; i++) {
			const b0 = Math.floor((x0 + i) * perPx)
			const b1 = Math.max(b0 + 1, Math.ceil((x0 + i + 1) * perPx))
			let lo = 0
			let hi = 0
			for (let b = b0; b < b1 && b < buckets; b++) {
				if (peaks[2 * b] < lo) lo = peaks[2 * b]
				if (peaks[2 * b + 1] > hi) hi = peaks[2 * b + 1]
			}
			const y1 = mid - hi * amp
			ctx.fillRect(i, y1, 1, Math.max(1, mid - lo * amp - y1))
		}
	}, [path, zoom, x0, width])
	return <canvas ref={ref} width={width} height={AUDIO_CLIP_H} className="pointer-events-none absolute top-0" style={{ left: x0 }} />
}

function AudioClipView({ clip, zoom, selected }: { clip: AudioClip; zoom: number; selected: boolean }): React.JSX.Element {
	const status = useStore((s) => s.audioStatus[clip.path])
	const w = clip.duration * zoom
	const tiles = Math.ceil(w / TILE_W)

	const move = (e: React.PointerEvent): void => itemPointerDown(e, clip.id)

	return (
		<div
			className="absolute top-1 z-[1] cursor-grab overflow-hidden rounded bg-[#0d2347] active:cursor-grabbing"
			style={{
				left: clip.start * zoom,
				width: w,
				height: AUDIO_CLIP_H,
				outline: selected ? "2px solid #fff" : "1px solid rgba(77,163,255,0.5)",
				outlineOffset: -1,
			}}
			data-item-id={clip.id}
			onPointerDown={move}
		>
			{status === "ready" &&
				Array.from({ length: tiles }, (_, k) => (
					<WaveTile key={k} path={clip.path} zoom={zoom} x0={k * TILE_W} width={Math.min(TILE_W, w - k * TILE_W)} />
				))}
			{clip.beats?.map((b, i) => (
				<div key={i} className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/30" style={{ left: b * zoom }} />
			))}
			<span className="pointer-events-none absolute top-0.5 left-2 text-[10px] font-medium text-white [text-shadow:0_0_3px_#000]">
				{status === "loading" && "Loading… "}
				{status === "missing" && "File missing — "}
				{clip.name}
				{clip.bpm ? ` · ${clip.bpm} BPM` : ""}
			</span>
		</div>
	)
}

function ClipView({
	clip,
	zoom,
	selected,
	handles,
}: {
	clip: Clip
	zoom: number
	selected: boolean
	handles: boolean
}): React.JSX.Element {
	const st = useStore.getState
	const w = clip.duration * zoom
	const fiW = clip.fadeIn * zoom
	const foW = clip.fadeOut * zoom

	const move = (e: React.PointerEvent): void => itemPointerDown(e, clip.id)
	const trimL = (e: React.PointerEvent): void => {
		st().selectClip(clip.id)
		const s0 = clip.start
		startDrag(e, (dx) => st().trimStart(clip.id, snapTime(s0 + dx / zoom, clip.id)))
	}
	const trimR = (e: React.PointerEvent): void => {
		st().selectClip(clip.id)
		const e0 = clip.start + clip.duration
		startDrag(e, (dx) => st().trimEnd(clip.id, snapTime(e0 + dx / zoom, clip.id)))
	}
	const fadeL = (e: React.PointerEvent): void => {
		const f0 = clip.fadeIn
		startDrag(e, (dx) => st().updateClip(clip.id, { fadeIn: Math.max(0, f0 + dx / zoom) }))
	}
	const fadeR = (e: React.PointerEvent): void => {
		const f0 = clip.fadeOut
		startDrag(e, (dx) => st().updateClip(clip.id, { fadeOut: Math.max(0, f0 - dx / zoom) }))
	}

	return (
		<div
			className="absolute top-1 z-[1] cursor-grab overflow-hidden rounded active:cursor-grabbing"
			style={{
				left: clip.start * zoom,
				width: w,
				height: CLIP_H,
				background: `rgb(${clip.r},${clip.g},${clip.b})`,
				outline: selected ? "2px solid #fff" : "1px solid rgba(0,0,0,0.45)",
				outlineOffset: -1,
			}}
			data-item-id={clip.id}
			onPointerDown={move}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			<svg width={w} height={CLIP_H} className="pointer-events-none absolute inset-0">
				{fiW > 0 && <polygon points={`0,0 ${fiW},0 0,${CLIP_H}`} fill="rgba(0,0,0,0.55)" />}
				{foW > 0 && <polygon points={`${w},0 ${w - foW},0 ${w},${CLIP_H}`} fill="rgba(0,0,0,0.55)" />}
			</svg>
			<span className="pointer-events-none absolute bottom-0.5 left-2 text-[10px] font-medium text-white [text-shadow:0_0_3px_#000]">
				{Math.round(clip.intensity * 100)}%
			</span>
			<div className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize" onPointerDown={trimL} />
			<div className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize" onPointerDown={trimR} />
			{handles && (
				<>
					<div
						className="absolute top-1 h-2.5 w-2.5 cursor-ew-resize rounded-full border border-black bg-white"
						style={{ left: Math.max(2, fiW - 5) }}
						title="Drag to set the fade-in"
						onPointerDown={fadeL}
					/>
					<div
						className="absolute top-1 h-2.5 w-2.5 cursor-ew-resize rounded-full border border-black bg-white"
						style={{ left: Math.min(w - 12, w - foW - 5) }}
						title="Drag to set the fade-out"
						onPointerDown={fadeR}
					/>
				</>
			)}
		</div>
	)
}
