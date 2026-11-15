import { useMemo, useState } from "react"

import {
	BUILTIN_EFFECTS,
	ENGINES,
	type EffectDef,
	type Engine,
	type Settings,
	type Spec,
	countClipsInRange,
	normalizeSettings,
	packToJson,
	parsePack,
} from "../lib/effects"
import { motionOf } from "../lib/motion"
import { useStore } from "../lib/store"

const small = "rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"
const CATEGORY_ORDER = ["Chases", "Pulses", "Washes", "Texture", "Moving heads"]
const fmtT = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`

/** Show only the settings that matter given the others (a tempo box means nothing when timing is in seconds). */
function visible(engine: Engine, key: string, s: Settings): boolean {
	if (engine === "pulse") {
		if (key === "interval") return s.timing === "seconds"
		if (key === "every" || key === "bpm") return s.timing === "beats"
		if (key === "stagger") return s.pattern === "chase"
	}
	if (engine === "chase") {
		if (key === "colors") return s.colorMode === "palette"
		if (key === "hueStep") return s.colorMode === "rainbow"
	}
	if (engine === "wash") {
		if (key === "colors") return s.mode !== "rainbow"
		if (key === "saturation") return s.mode === "rainbow"
		if (key === "cycle") return s.mode !== "gradient"
	}
	if (engine === "flicker") {
		if (key === "colors") return s.style === "palette"
		if (key === "gapChance") return s.gaps === true
	}
	return true
}

function Control(props: { spec: Spec; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
	const { spec, value, onChange } = props
	if (spec.type === "number") {
		const v = typeof value === "number" ? value : spec.default
		return (
			<div>
				<div className="mb-1 flex justify-between">
					<span>{spec.label}</span>
					<span className="text-muted">
						{Number.isInteger(v) ? v : v.toFixed(2)}
						{spec.unit ? ` ${spec.unit}` : ""}
					</span>
				</div>
				<input type="range" className="w-full" min={spec.min} max={spec.max} step={spec.step ?? 1} value={v} onChange={(e) => onChange(Number(e.target.value))} />
			</div>
		)
	}
	if (spec.type === "choice") {
		return (
			<label className="flex items-center justify-between gap-2">
				<span>{spec.label}</span>
				<select className="min-w-0 rounded border border-line bg-panel px-2 py-1" value={String(value ?? spec.default)} onChange={(e) => onChange(e.target.value)}>
					{spec.options.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</label>
		)
	}
	if (spec.type === "color") {
		return (
			<label className="flex items-center justify-between">
				<span>{spec.label}</span>
				<input type="color" className="h-7 w-16 cursor-pointer border border-line bg-transparent" value={String(value ?? spec.default)} onChange={(e) => onChange(e.target.value)} />
			</label>
		)
	}
	if (spec.type === "colors") {
		const list = Array.isArray(value) ? (value as string[]) : spec.default
		return (
			<div>
				<div className="mb-1">{spec.label}</div>
				<div className="flex flex-wrap items-center gap-1">
					{list.map((c, i) => (
						<input
							key={i}
							type="color"
							className="h-7 w-9 cursor-pointer border border-line bg-transparent"
							value={c}
							onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
						/>
					))}
					<button className={small} disabled={list.length >= spec.max} onClick={() => onChange([...list, list[list.length - 1] ?? "#ffffff"])} title="Add a colour">
						+
					</button>
					<button className={small} disabled={list.length <= 1} onClick={() => onChange(list.slice(0, -1))} title="Remove the last colour">
						−
					</button>
				</div>
			</div>
		)
	}
	return (
		<label className="flex items-center justify-between">
			<span>{spec.label}</span>
			<input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
		</label>
	)
}

function EffectDetail({ def, onBack }: { def: EffectDef; onBack: () => void }): React.JSX.Element {
	const fixtures = useStore((s) => s.fixtures)
	const audioClips = useStore((s) => s.audioClips)
	const selectedAudioId = useStore((s) => s.selectedAudioId)
	const playhead = useStore((s) => s.playhead)
	const st = useStore.getState
	const schema = ENGINES[def.engine].settings
	const moving = ENGINES[def.engine].kind === "move"

	const [values, setValues] = useState<Record<string, unknown>>({})
	const [length, setLength] = useState(def.length)
	const [at, setAt] = useState<number | null>(null) // null = wherever the playhead is
	const [excluded, setExcluded] = useState<Set<string>>(new Set())
	const [replace, setReplace] = useState(true)
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

	const settings = useMemo(() => normalizeSettings(def.engine, { ...def.settings, ...values }), [def, values])
	const eligible = fixtures.filter((f) => !moving || motionOf(f))
	const chosen = eligible.filter((f) => !excluded.has(f.id))
	const song = audioClips.find((a) => a.id === selectedAudioId)
	const beatSong = audioClips.find((a) => a.id === selectedAudioId && a.beats?.length) ?? audioClips.find((a) => a.beats?.length)

	const add = (): void => {
		const start = at ?? st().playhead
		const ids = chosen.map((f) => f.id)
		const end = start + length
		const impact = !replace
			? 0
			: moving
				? st().frames.filter((f) => ids.includes(f.fixtureId) && f.start >= start && f.start <= end).length
				: countClipsInRange(st().clips, new Set(ids), start, end)
		if (impact > 0) {
			const what = moving ? "movement frames" : "clips"
			if (!window.confirm(`This will replace ${impact} existing ${what} on those lights between ${fmtT(start)} and ${fmtT(end)}.\n\nThere's no undo yet. Continue?`)) return
		}
		const res = st().applyEffect(def, values, { start, length, fixtureIds: ids, replace })
		if (!res.ok) setMessage({ ok: false, text: res.error })
		else {
			const made = res.frames ? `${res.frames} movement frames` : `${res.clips} clips`
			setMessage({ ok: true, text: `Added ${made} from ${fmtT(start)} to ${fmtT(end)}.${res.skipped ? ` ${res.skipped} were skipped because they'd land on existing clips.` : ""}` })
		}
	}

	return (
		<div className="space-y-4">
			<button className={small} onClick={onBack}>
				← All effects
			</button>
			<section>
				<h3 className="text-base font-semibold">{def.name}</h3>
				<p className="text-muted">{def.description}</p>
			</section>

			<section className="space-y-2 rounded border border-line bg-panel2 p-2">
				<h4 className="text-xs uppercase tracking-wider text-muted">Where</h4>
				<div className="flex items-center justify-between">
					<span>Starts</span>
					<span>
						{at === null ? (
							<>
								at the playhead <span className="text-muted">({fmtT(playhead)})</span>
							</>
						) : (
							<>
								{fmtT(at)}{" "}
								<button className="text-accent underline" onClick={() => setAt(null)}>
									use playhead
								</button>
							</>
						)}
					</span>
				</div>
				<label className="flex items-center justify-between">
					<span>Lasts (seconds)</span>
					<input
						type="number"
						min={0.5}
						max={600}
						step={0.5}
						className="w-24 rounded border border-line bg-panel px-2 py-1"
						value={length}
						onChange={(e) => setLength(Math.min(600, Math.max(0.5, Number(e.target.value) || def.length)))}
					/>
				</label>
				{song && (
					<button
						className={`${small} w-full`}
						onClick={() => {
							setAt(song.start)
							setLength(Math.round(song.duration * 10) / 10)
						}}
					>
						Fit to the selected song ({song.name.slice(0, 24)})
					</button>
				)}
			</section>

			<section className="space-y-1 rounded border border-line bg-panel2 p-2">
				<h4 className="text-xs uppercase tracking-wider text-muted">{moving ? "Moving heads" : "Lights"}</h4>
				{eligible.length === 0 && <p className="text-muted">{moving ? "Add a Moving Head from the Fixtures tab first." : "Add a light from the Fixtures tab first."}</p>}
				{eligible.map((f) => (
					<label key={f.id} className="flex items-center justify-between">
						<span className="truncate">{f.name}</span>
						<input
							type="checkbox"
							checked={!excluded.has(f.id)}
							onChange={(e) => {
								const next = new Set(excluded)
								if (e.target.checked) next.delete(f.id)
								else next.add(f.id)
								setExcluded(next)
							}}
						/>
					</label>
				))}
				{eligible.length > 1 && <p className="text-muted">Chases run in the order of your tracks, top to bottom.</p>}
			</section>

			<section className="space-y-3 rounded border border-line bg-panel2 p-2">
				<h4 className="text-xs uppercase tracking-wider text-muted">Settings</h4>
				{def.expose
					.filter((k) => visible(def.engine, k, settings))
					.map((k) => (
						<Control key={k} spec={schema[k]} value={settings[k]} onChange={(v) => setValues({ ...values, [k]: v })} />
					))}
				{def.engine === "pulse" && settings.timing === "beats" && (
					<p className="text-muted">
						{beatSong
							? `Flashes land on the beats of ${beatSong.name.slice(0, 28)}.`
							: `No beats found yet, so it will use ${settings.bpm} BPM. For a tight lock, detect the beats in the Audio tab first.`}
					</p>
				)}
				{def.expose.length === 0 && <p className="text-muted">This effect has no settings to adjust.</p>}
			</section>

			<label className="flex items-start gap-2">
				<input type="checkbox" className="mt-1" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
				<span>
					Replace what's already there
					<span className="block text-muted">{moving ? "Clears existing movement frames in that time." : "Cuts existing clips out of that time on those lights. Off = only fill the gaps."}</span>
				</span>
			</label>

			<button className="w-full rounded bg-accent px-3 py-2 font-semibold text-black disabled:opacity-40" disabled={chosen.length === 0} onClick={add}>
				Add to timeline
			</button>
			{message && <p className={message.ok ? "text-green-400" : "text-red-400"}>{message.text}</p>}
		</div>
	)
}

export function EffectsTab(): React.JSX.Element {
	const custom = useStore((s) => s.customEffects)
	const runs = useStore((s) => s.effectRuns)
	const st = useStore.getState
	const [openId, setOpenId] = useState<string | null>(null)
	const [note, setNote] = useState("")

	const all = useMemo(() => [...BUILTIN_EFFECTS, ...custom], [custom])
	const open = all.find((e) => e.id === openId)
	if (open) return <EffectDetail key={open.id} def={open} onBack={() => setOpenId(null)} />

	const categories = [...new Set(all.map((e) => e.category))].sort((a, b) => {
		const ia = CATEGORY_ORDER.indexOf(a)
		const ib = CATEGORY_ORDER.indexOf(b)
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
	})
	const isCustom = (id: string): boolean => custom.some((e) => e.id === id)

	const importPack = async (): Promise<void> => {
		const r = await window.studio?.openText()
		if (!r) return
		if ("error" in r) return setNote(r.error)
		const { effects, problems } = parsePack(r.text)
		const n = effects.length ? st().importEffects(effects) : 0
		setNote(n ? `Added ${n} effect${n === 1 ? "" : "s"}.${problems.length ? ` ${problems.length} skipped.` : ""}` : (problems[0] ?? "Nothing to add."))
	}

	return (
		<div className="space-y-4">
			<p className="text-muted">Pick an effect, set it up, and it's written onto the timeline as ordinary clips you can edit.</p>
			{categories.map((cat) => (
				<section key={cat}>
					<h3 className="mb-2 text-xs uppercase tracking-wider text-muted">{cat}</h3>
					<div className="space-y-1">
						{all
							.filter((e) => e.category === cat)
							.map((e) => (
								<div key={e.id} className="flex items-stretch gap-1">
									<button className="min-w-0 flex-1 rounded border border-line bg-panel2 px-2 py-2 text-left hover:border-accent" onClick={() => setOpenId(e.id)}>
										<div className="truncate font-medium">{e.name}</div>
										<div className="line-clamp-2 text-muted">{e.description}</div>
									</button>
									{isCustom(e.id) && (
										<button className="px-2 text-muted hover:text-red-400" title="Remove this imported effect (clips already on the timeline stay)" onClick={() => st().removeCustomEffect(e.id)}>
											✕
										</button>
									)}
								</div>
							))}
					</div>
				</section>
			))}

			<section className="space-y-2">
				<h3 className="text-xs uppercase tracking-wider text-muted">Effect packs</h3>
				<div className="flex gap-2">
					<button className={`${small} flex-1`} onClick={() => void importPack()}>
						Import pack…
					</button>
					<button
						className={`${small} flex-1`}
						title="Save the built-in effects as a pack file: a handy example of the format"
						onClick={() => void window.studio?.saveText("dmx-studio-effects.json", packToJson(BUILTIN_EFFECTS))}
					>
						Save example pack…
					</button>
				</div>
				{custom.length > 0 && (
					<button className={`${small} w-full`} onClick={() => void window.studio?.saveText("my-effects.json", packToJson(custom))}>
						Export my imported effects…
					</button>
				)}
				{note && <p className="text-muted">{note}</p>}
			</section>

			{runs.length > 0 && (
				<section className="space-y-1">
					<h3 className="text-xs uppercase tracking-wider text-muted">On your timeline</h3>
					{runs.map((r) => (
						<div key={r.id} className="flex items-center justify-between rounded border border-line px-2 py-1.5">
							<div className="min-w-0">
								<div className="truncate">{r.name}</div>
								<div className="text-muted">
									{fmtT(r.start)}–{fmtT(r.end)} · {r.frames ? `${r.frames} frames` : `${r.clips} clips`}
								</div>
							</div>
							<button className={small} onClick={() => st().removeEffectRun(r.id)} title="Take this effect back off the timeline (clips it replaced don't come back)">
								Remove
							</button>
						</div>
					))}
				</section>
			)}
		</div>
	)
}
