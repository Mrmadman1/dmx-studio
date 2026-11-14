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

export function Inspector(): React.JSX.Element {
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
			<aside className="bg-panel p-3">
				<h3 className="mb-2 text-xs uppercase tracking-wider text-muted">Inspector</h3>
				<p className="text-muted">Select a light or a clip to adjust it.</p>
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
