import type { Curve } from "../lib/show"

import { type Arrival, motionOf, motionReport } from "../lib/motion"
import { type MotionSpec, profileById } from "../lib/profiles"
import { DEG, type Vec3, defaultTransform, fixtureTransform } from "../lib/stage"
import { useStore } from "../lib/store"

const hex = (n: number): string => Math.round(n).toString(16).padStart(2, "0")
const toHex = (r: number, g: number, b: number): string => `#${hex(r)}${hex(g)}${hex(b)}`
const parseHex = (v: string): [number, number, number] => [
	Number.parseInt(v.slice(1, 3), 16),
	Number.parseInt(v.slice(3, 5), 16),
	Number.parseInt(v.slice(5, 7), 16),
]

function Slider(props: {
	label: string
	value: number
	min: number
	max: number
	step?: number
	unit?: string
	disabled?: boolean
	onChange: (v: number) => void
}): React.JSX.Element {
	return (
		<div className={props.disabled ? "opacity-40" : ""}>
			<div className="mb-1 flex justify-between">
				<span>{props.label}</span>
				<span className="text-muted">
					{Number.isInteger(props.value) ? props.value : props.value.toFixed(2)}
					{props.unit}
				</span>
			</div>
			<input
				type="range"
				className="w-full"
				min={props.min}
				max={props.max}
				step={props.step ?? 1}
				value={props.value}
				disabled={props.disabled}
				onChange={(e) => props.onChange(Number(e.target.value))}
			/>
		</div>
	)
}

/** Settings for the selected accent point. */
function AccentPanel({ id }: { id: string }): React.JSX.Element | null {
	const accent = useStore((s) => s.accents.find((a) => a.id === id))
	const fixtures = useStore((s) => s.fixtures)
	const update = useStore((s) => s.updateAccent)
	const remove = useStore((s) => s.removeAccent)
	if (!accent) return null

	const hitsAll = accent.fixtureIds === null
	const toggle = (fid: string): void => {
		const current = accent.fixtureIds ?? fixtures.map((f) => f.id)
		const next = current.includes(fid) ? current.filter((x) => x !== fid) : [...current, fid]
		if (next.length === 0) return // an accent has to hit at least one light
		update(id, { fixtureIds: next.length === fixtures.length ? null : next })
	}

	return (
		<section className="space-y-3 rounded border border-[#ffb02e]/50 bg-panel2 p-2">
			<h4 className="text-xs uppercase tracking-wider text-[#ffb02e]">Accent point</h4>
			<Slider
				label="Brightness boost"
				value={Math.round(accent.amount * 100)}
				min={0}
				max={100}
				unit="%"
				onChange={(v) => update(id, { amount: v / 100 })}
			/>
			<Slider
				label="Lasts"
				value={accent.duration}
				min={0.1}
				max={8}
				step={0.05}
				unit="s"
				onChange={(v) => update(id, { duration: v })}
			/>
			<Slider
				label="Fade in"
				value={accent.fadeIn}
				min={0}
				max={Math.max(0, accent.duration - accent.fadeOut)}
				step={0.01}
				unit="s"
				onChange={(v) => update(id, { fadeIn: v })}
			/>
			<Slider
				label="Fade out"
				value={accent.fadeOut}
				min={0}
				max={Math.max(0, accent.duration - accent.fadeIn)}
				step={0.01}
				unit="s"
				onChange={(v) => update(id, { fadeOut: v })}
			/>
			<label className="flex items-center justify-between">
				<span>Fade curve</span>
				<select
					className="rounded border border-line bg-panel px-2 py-1"
					value={accent.curve}
					onChange={(e) => update(id, { curve: e.target.value as Curve })}
				>
					<option value="smooth">Smooth</option>
					<option value="linear">Linear</option>
				</select>
			</label>
			<div className="space-y-1">
				<label className="flex items-center justify-between">
					<span>Hits all lights</span>
					<input
						type="checkbox"
						checked={hitsAll}
						disabled={fixtures.length === 0}
						onChange={(e) => update(id, { fixtureIds: e.target.checked ? null : fixtures.map((f) => f.id) })}
					/>
				</label>
				{!hitsAll &&
					fixtures.map((f) => (
						<label key={f.id} className="flex items-center justify-between pl-3 text-muted">
							<span className="truncate">{f.name}</span>
							<input
								type="checkbox"
								checked={accent.fixtureIds?.includes(f.id) ?? false}
								onChange={() => toggle(f.id)}
							/>
						</label>
					))}
			</div>
			<p className="text-muted">Brightens lights that have clips on the timeline. It adds to the clip's brightness, up to full.</p>
			<div className="flex items-center justify-between text-muted">
				<span>Starts {accent.start.toFixed(2)}s</span>
				<button className="rounded border border-line px-2 py-1 hover:text-red-400" onClick={() => remove(id)}>
					Delete
				</button>
			</div>
		</section>
	)
}

/**
 * Three number boxes (x, y, z). Typing commits when you leave the box or press Enter, so half-typed
 * values like "-" never reach the scene; the boxes refresh when the gizmo moves the light.
 */
function VecRow(props: { label: string; value: Vec3; scale?: number; step: number; onCommit: (v: Vec3) => void }): React.JSX.Element {
	const { label, value, scale = 1, step, onCommit } = props
	return (
		<div className="flex items-center gap-1">
			<span className="w-14 shrink-0 text-muted">{label}</span>
			{(["x", "y", "z"] as const).map((axis, i) => (
				<input
					key={`${axis}-${value[i]}`}
					type="number"
					step={step}
					title={axis.toUpperCase()}
					className="w-full min-w-0 rounded border border-line bg-panel2 px-1.5 py-1"
					defaultValue={Number((value[i] * scale).toFixed(2))}
					onBlur={(e) => {
						const n = Number.parseFloat(e.target.value)
						if (!Number.isFinite(n)) return
						const next = value.slice() as Vec3
						next[i] = n / scale
						onCommit(next)
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur()
					}}
				/>
			))}
		</div>
	)
}

/** One pose of a moving head: where it should point, how it gets there, and whether its motors can manage it. */
function FramePanel({ id }: { id: string }): React.JSX.Element | null {
	const frame = useStore((s) => s.frames.find((f) => f.id === id))
	const fixture = useStore((s) => s.fixtures.find((f) => f.id === frame?.fixtureId))
	const arrival: Arrival | undefined = useStore((s) => (frame && fixture ? motionReport(fixture, s.frames).get(frame.id) : undefined))
	const update = useStore((s) => s.updateFrame)
	const spec = fixture ? motionOf(fixture) : null
	if (!frame || !fixture || !spec) return null

	const verdict = !arrival
		? null
		: !arrival.reached
			? { tone: "text-red-400", text: "The head can't reach this pose before the next frame starts. Move the frames apart, or make the move smaller." }
			: arrival.late > 0.05
				? { tone: "text-amber-300", text: `The head arrives ${arrival.late.toFixed(2)} s late: its motors can't turn that fast. Give this move more time, or turn it less.` }
				: { tone: "text-green-400", text: "The head gets here on time." }

	return (
		<section className="space-y-3 rounded border border-[#4ade80]/50 bg-panel2 p-2">
			<h4 className="text-xs uppercase tracking-wider text-[#4ade80]">Movement frame · {fixture.name}</h4>
			<Slider
				label="Pan (turn)"
				value={Math.round(frame.pan)}
				min={-spec.panRange / 2}
				max={spec.panRange / 2}
				unit="°"
				onChange={(v) => update(id, { pan: v })}
			/>
			<Slider
				label="Tilt (nod)"
				value={Math.round(frame.tilt)}
				min={-spec.tiltRange / 2}
				max={spec.tiltRange / 2}
				unit="°"
				onChange={(v) => update(id, { tilt: v })}
			/>
			<label className="flex items-center justify-between">
				<span title="How the head travels INTO this pose from the one before">Move in</span>
				<select
					className="rounded border border-line bg-panel px-2 py-1"
					value={frame.ease}
					onChange={(e) => update(id, { ease: e.target.value as "smooth" | "linear" | "hold" })}
				>
					<option value="smooth">Smooth (eases in and out)</option>
					<option value="linear">Linear (steady speed)</option>
					<option value="hold">Snap (waits, then goes at full speed)</option>
				</select>
			</label>
			<label className="flex items-center justify-between">
				<span>At time (s)</span>
				<input
					key={frame.start}
					type="number"
					step={0.1}
					min={0}
					className="w-24 rounded border border-line bg-panel px-2 py-1"
					defaultValue={Number(frame.start.toFixed(2))}
					onBlur={(e) => {
						const n = Number.parseFloat(e.target.value)
						if (Number.isFinite(n)) update(id, { start: n })
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur()
					}}
				/>
			</label>
			{verdict && <p className={verdict.tone}>{verdict.text}</p>}
			<p className="text-muted">The preview and the real head move at the speed its motors allow, so a fast move shows as the head lagging behind.</p>
		</section>
	)
}

const MOTION_FIELDS: { key: keyof MotionSpec; label: string; unit: string; min: number; max: number; step: number }[] = [
	{ key: "panSpeed", label: "Pan speed", unit: "°/s", min: 20, max: 720, step: 5 },
	{ key: "tiltSpeed", label: "Tilt speed", unit: "°/s", min: 20, max: 720, step: 5 },
	{ key: "accel", label: "Acceleration", unit: "°/s²", min: 100, max: 4000, step: 50 },
	{ key: "panRange", label: "Pan range", unit: "°", min: 90, max: 720, step: 10 },
	{ key: "tiltRange", label: "Tilt range", unit: "°", min: 90, max: 360, step: 10 },
]

/** A moving head's motors. The defaults are typical; set them to match your real fixture so the preview and warnings are honest. */
function MotionPanel({ id }: { id: string }): React.JSX.Element | null {
	const fixture = useStore((s) => s.fixtures.find((f) => f.id === id))
	const setMotion = useStore((s) => s.setMotion)
	const spec = fixture ? motionOf(fixture) : null
	if (!fixture || !spec) return null
	return (
		<section className="space-y-3 rounded border border-line bg-panel2 p-2">
			<div className="flex items-center justify-between">
				<h4 className="text-xs uppercase tracking-wider text-muted">Motors</h4>
				<button
					className="rounded border border-line px-2 py-0.5 text-xs hover:bg-line"
					title="Back to this fixture type's typical values"
					onClick={() => setMotion(id, null)}
				>
					Reset
				</button>
			</div>
			{MOTION_FIELDS.map((m) => (
				<Slider
					key={m.key}
					label={m.label}
					value={spec[m.key]}
					min={m.min}
					max={m.max}
					step={m.step}
					unit={m.unit}
					onChange={(v) => setMotion(id, { [m.key]: v })}
				/>
			))}
			<p className="text-muted">
				To match a real head, time one full pan from end to end: speed = range ÷ seconds. Frames the motors can't reach in time are flagged on the timeline.
			</p>
		</section>
	)
}

/** Shown when several timeline items are selected at once. */
function MultiPanel({ count }: { count: number }): React.JSX.Element {
	const deleteSelection = useStore((s) => s.deleteSelection)
	return (
		<section className="space-y-2 rounded border border-accent/50 bg-panel2 p-2">
			<h4 className="text-xs uppercase tracking-wider text-accent">{count} items selected</h4>
			<p className="text-muted">
				Drag any of them to move the whole group. Hold Alt while dragging to drop copies instead. Copy, Cut, Paste,
				Duplicate and Delete all work on the group, and a paste keeps the spacing.
			</p>
			<p className="text-muted">Click one item on its own to edit it.</p>
			<button className="rounded border border-line px-2 py-1 hover:text-red-400" onClick={deleteSelection}>
				Delete all {count}
			</button>
		</section>
	)
}

export function Inspector(): React.JSX.Element {
	const selectionCount = useStore((s) => s.selection.length)
	const selectedAccentId = useStore((s) => s.selectedAccentId)
	const fixture = useStore((s) => s.fixtures.find((f) => f.id === s.selectedId))
	const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId))
	const driven = useStore((s) => s.mode === "timeline" && s.clips.some((c) => c.fixtureId === s.selectedId))
	const drivenMotion = useStore((s) => s.mode === "timeline" && s.frames.some((f) => f.fixtureId === s.selectedId))
	const selectedFrameId = useStore((s) => s.selectedFrameId)
	const setValue = useStore((s) => s.setValue)
	const setRgb = useStore((s) => s.setRgb)
	const setAddress = useStore((s) => s.setAddress)
	const rename = useStore((s) => s.renameFixture)
	const updateClip = useStore((s) => s.updateClip)
	const removeClip = useStore((s) => s.removeClip)
	const stageView = useStore((s) => s.stageView)
	const fixtureIndex = useStore((s) => s.fixtures.findIndex((f) => f.id === s.selectedId))
	const fixtureCount = useStore((s) => s.fixtures.length)
	const setTransform = useStore((s) => s.setFixtureTransform)
	useStore((s) => s.stageStatus) // a loaded stage changes each light's default spot, so redraw when it does

	if (!fixture) {
		return (
			<aside className="min-h-0 space-y-4 overflow-y-auto bg-panel p-3">
				<h3 className="text-xs uppercase tracking-wider text-muted">Inspector</h3>
				{selectionCount > 1 ? (
					<MultiPanel count={selectionCount} />
				) : selectedAccentId ? (
					<AccentPanel id={selectedAccentId} />
				) : (
					<p className="text-muted">Select a light, a clip or an accent to adjust it.</p>
				)}
			</aside>
		)
	}

	const profile = profileById(fixture.profileId)
	const idx = (kind: string): number => profile.channels.findIndex((c) => c.kind === kind)
	const hasRgb = idx("red") >= 0 && idx("green") >= 0 && idx("blue") >= 0
	const color = hasRgb
		? toHex(fixture.values[idx("red")], fixture.values[idx("green")], fixture.values[idx("blue")])
		: "#ffffff"
	const timelineOwns = (kind: string): boolean =>
		(driven && (kind === "dimmer" || kind === "red" || kind === "green" || kind === "blue")) ||
		(drivenMotion && (kind === "pan" || kind === "panFine" || kind === "tilt" || kind === "tiltFine"))

	return (
		<aside className="min-h-0 space-y-4 overflow-y-auto bg-panel p-3">
			<h3 className="text-xs uppercase tracking-wider text-muted">Inspector</h3>

			{selectionCount > 1 && <MultiPanel count={selectionCount} />}
			{selectedAccentId && <AccentPanel id={selectedAccentId} />}
			{selectedFrameId && <FramePanel id={selectedFrameId} />}

			{clip && (
				<section className="space-y-3 rounded border border-accent/50 bg-panel2 p-2">
					<h4 className="text-xs uppercase tracking-wider text-accent">Clip</h4>
					<label className="flex items-center justify-between">
						<span>Colour</span>
						<input
							type="color"
							className="h-8 w-20 cursor-pointer border border-line bg-transparent"
							value={toHex(clip.r, clip.g, clip.b)}
							onChange={(e) => {
								const [r, g, b] = parseHex(e.target.value)
								updateClip(clip.id, { r, g, b })
							}}
						/>
					</label>
					<Slider
						label="Brightness"
						value={Math.round(clip.intensity * 100)}
						min={0}
						max={100}
						unit="%"
						onChange={(v) => updateClip(clip.id, { intensity: v / 100 })}
					/>
					<Slider
						label="Fade in"
						value={clip.fadeIn}
						min={0}
						max={Math.max(0, clip.duration - clip.fadeOut)}
						step={0.05}
						unit="s"
						onChange={(v) => updateClip(clip.id, { fadeIn: v })}
					/>
					<Slider
						label="Fade out"
						value={clip.fadeOut}
						min={0}
						max={Math.max(0, clip.duration - clip.fadeIn)}
						step={0.05}
						unit="s"
						onChange={(v) => updateClip(clip.id, { fadeOut: v })}
					/>
					<label className="flex items-center justify-between">
						<span>Fade curve</span>
						<select
							className="rounded border border-line bg-panel px-2 py-1"
							value={clip.curve}
							onChange={(e) => updateClip(clip.id, { curve: e.target.value as Curve })}
						>
							<option value="smooth">Smooth</option>
							<option value="linear">Linear</option>
						</select>
					</label>
					<div className="flex items-center justify-between text-muted">
						<span>
							Starts {clip.start.toFixed(2)}s · Length {clip.duration.toFixed(2)}s
						</span>
						<button
							className="rounded border border-line px-2 py-1 hover:text-red-400"
							onClick={() => removeClip(clip.id)}
						>
							Delete
						</button>
					</div>
				</section>
			)}

			<input
				className="w-full rounded border border-line bg-panel2 px-2 py-1"
				value={fixture.name}
				onChange={(e) => rename(fixture.id, e.target.value)}
			/>
			<label className="flex items-center justify-between">
				<span>DMX start address</span>
				<input
					type="number"
					min={1}
					max={512}
					className="w-20 rounded border border-line bg-panel2 px-2 py-1"
					value={fixture.address}
					onChange={(e) => setAddress(fixture.id, Number(e.target.value))}
				/>
			</label>

			{motionOf(fixture) && <MotionPanel id={fixture.id} />}
			{drivenMotion && (
				<p className="rounded border border-line bg-panel2 p-2 text-muted">
					This head has movement frames, so the timeline controls where it points. Its brightness and colour are separate.
				</p>
			)}

			{stageView === "3d" && (
				<section className="space-y-2 rounded border border-line bg-panel2 p-2">
					<div className="flex items-center justify-between">
						<h4 className="text-xs uppercase tracking-wider text-muted">3D position</h4>
						<button
							className="rounded border border-line px-2 py-0.5 text-xs hover:bg-line"
							title="Put this light back in its starting spot on the truss"
							onClick={() => {
								const d = defaultTransform(fixtureIndex, fixtureCount)
								setTransform(fixture.id, d.pos, d.rot)
							}}
						>
							Reset
						</button>
					</div>
					{(() => {
						const t = fixtureTransform(fixture, fixtureIndex, fixtureCount)
						return (
							<>
								<VecRow label="Move (m)" value={t.pos} step={0.1} onCommit={(pos) => setTransform(fixture.id, pos, t.rot)} />
								<VecRow label="Turn (°)" value={t.rot} scale={DEG} step={5} onCommit={(rot) => setTransform(fixture.id, t.pos, rot)} />
							</>
						)
					})()}
					<p className="text-muted">Or click the light in the 3D view and drag its arrows (W move, E rotate).</p>
				</section>
			)}

			{driven && (
				<p className="rounded border border-line bg-panel2 p-2 text-muted">
					This light has clips, so the timeline controls its brightness and colour. The other channels
					are still manual.
				</p>
			)}

			{hasRgb && !driven && (
				<label className="flex items-center justify-between">
					<span>Colour</span>
					<input
						type="color"
						className="h-8 w-20 cursor-pointer border border-line bg-transparent"
						value={color}
						onChange={(e) => {
							const [r, g, b] = parseHex(e.target.value)
							setRgb(fixture.id, r, g, b)
						}}
					/>
				</label>
			)}

			<section className="space-y-3">
				<h4 className="text-xs uppercase tracking-wider text-muted">Channels</h4>
				{profile.channels.map((c, i) => (
					<Slider
						key={i}
						label={`Ch ${fixture.address + i}  ${c.name}`}
						value={fixture.values[i]}
						min={0}
						max={255}
						disabled={timelineOwns(c.kind)}
						onChange={(v) => setValue(fixture.id, i, v)}
					/>
				))}
			</section>
		</aside>
	)
}
