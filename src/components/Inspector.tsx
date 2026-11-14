import type { Curve } from "../lib/show"

import { profileById } from "../lib/profiles"
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
	const setValue = useStore((s) => s.setValue)
	const setRgb = useStore((s) => s.setRgb)
	const setAddress = useStore((s) => s.setAddress)
	const rename = useStore((s) => s.renameFixture)
	const updateClip = useStore((s) => s.updateClip)
	const removeClip = useStore((s) => s.removeClip)

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
		driven && (kind === "dimmer" || kind === "red" || kind === "green" || kind === "blue")

	return (
		<aside className="min-h-0 space-y-4 overflow-y-auto bg-panel p-3">
			<h3 className="text-xs uppercase tracking-wider text-muted">Inspector</h3>

			{selectionCount > 1 && <MultiPanel count={selectionCount} />}
			{selectedAccentId && <AccentPanel id={selectedAccentId} />}

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
