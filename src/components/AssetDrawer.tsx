import { useState } from "react"
import { EffectsTab } from "./EffectsTab"

import { addAudioFromPath, loadAudio, pickAudioFiles } from "../lib/audio"
import { detectBeats } from "../lib/beats"
import { PROFILES } from "../lib/profiles"
import { profileById } from "../lib/profiles"
import { addReferenceAudio, loadReferenceFromPath } from "../lib/reference"
import { useStore } from "../lib/store"

const TABS = ["Fixtures", "Audio", "Reference", "Effects", "Storefront"] as const
type Tab = (typeof TABS)[number]

export function AssetDrawer(): React.JSX.Element {
	const [tab, setTab] = useState<Tab>("Fixtures")
	return (
		<aside className="flex min-h-0 flex-col bg-panel">
			<nav className="flex flex-wrap border-b border-line">
				{TABS.map((t) => (
					<button
						key={t}
						className={`flex-1 px-2 py-2 ${tab === t ? "border-b-2 border-accent text-white" : "text-muted hover:text-white"}`}
						onClick={() => setTab(t)}
					>
						{t}
					</button>
				))}
			</nav>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{tab === "Fixtures" ? (
					<FixturesTab />
				) : tab === "Audio" ? (
					<AudioTab />
				) : tab === "Reference" ? (
					<ReferenceTab />
				) : tab === "Effects" ? (
					<EffectsTab />
				) : (
					<p className="text-muted">{tab} is coming in a later phase.</p>
				)}
			</div>
		</aside>
	)
}

const small = "rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40"

function fmtLen(sec: number): string {
	const m = Math.floor(sec / 60)
	return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`
}

function AudioTab(): React.JSX.Element {
	const audioClips = useStore((s) => s.audioClips)
	const selectedAudioId = useStore((s) => s.selectedAudioId)
	const audioStatus = useStore((s) => s.audioStatus)
	const fixtures = useStore((s) => s.fixtures)
	const selectedId = useStore((s) => s.selectedId)
	const [target, setTarget] = useState<"all" | "selected">("all")
	const [every, setEvery] = useState(1)
	const [busy, setBusy] = useState(false)
	const [note, setNote] = useState("")
	const st = useStore.getState
	const sel = audioClips.find((c) => c.id === selectedAudioId)

	const add = async (): Promise<void> => {
		let at = st().playhead
		for (const p of await pickAudioFiles()) at += await addAudioFromPath(p, at)
	}

	const detect = async (): Promise<void> => {
		if (!sel) return
		setBusy(true)
		setNote("")
		await new Promise((r) => setTimeout(r, 30)) // let the "Analysing…" label paint first
		const loaded = await loadAudio(sel.path)
		const res = loaded ? detectBeats(loaded.buffer) : null
		if (res) {
			st().setAudioBeats(sel.id, res.bpm, res.beats)
			setNote(`${res.bpm} BPM, ${res.beats.length} beats found. The thin lines on the clip are the beats.`)
		} else {
			setNote("Couldn't find a steady beat in that file.")
		}
		setBusy(false)
	}

	const flash = (): void => {
		if (!sel) return
		const ids = target === "all" ? fixtures.map((f) => f.id) : selectedId ? [selectedId] : []
		if (ids.length === 0) {
			setNote(target === "all" ? "Add a light first." : "Select a light first.")
			return
		}
		const n = st().addBeatClips(sel.id, ids, every)
		setNote(n ? `Added ${n} flashes to the timeline.` : "Nothing added (the beats are already filled).")
	}

	return (
		<div className="space-y-4">
			<section className="space-y-2">
				<button className={`${small} w-full py-2`} onClick={() => void add()}>
					+ Add audio file…
				</button>
				<p className="text-muted">Or drag an MP3 / WAV straight onto the timeline.</p>
			</section>

			<section>
				<h3 className="mb-2 text-xs uppercase tracking-wider text-muted">In this show</h3>
				{audioClips.length === 0 && <p className="text-muted">No audio yet.</p>}
				<div className="space-y-1">
					{audioClips.map((c) => (
						<div
							key={c.id}
							className={`flex items-center justify-between rounded border px-2 py-2 ${c.id === selectedAudioId ? "border-accent bg-panel2" : "border-line"}`}
							onClick={() => st().selectAudio(c.id)}
						>
							<div className="min-w-0">
								<div className="truncate">{c.name}</div>
								<div className="text-muted">
									{fmtLen(c.duration)}
									{c.bpm ? ` · ${c.bpm} BPM` : ""}
									{audioStatus[c.path] === "missing" ? " · file missing" : ""}
								</div>
							</div>
							<button
								className="px-2 text-muted hover:text-red-400"
								onClick={(e) => {
									e.stopPropagation()
									st().removeAudioClip(c.id)
								}}
							>
								✕
							</button>
						</div>
					))}
				</div>
			</section>

			{sel && (
				<section className="space-y-3 rounded border border-line bg-panel2 p-2">
					<h3 className="text-xs uppercase tracking-wider text-accent">Beat sync</h3>
					<button className={`${small} w-full`} disabled={busy} onClick={() => void detect()}>
						{busy ? "Analysing…" : sel.beats ? "Re-detect beats" : "1. Detect beats"}
					</button>
					<div className={sel.beats ? "space-y-2" : "space-y-2 opacity-40"}>
						<div className="text-muted">2. Add a flash on each beat</div>
						<label className="flex items-center justify-between">
							<span>Lights</span>
							<select
								className="rounded border border-line bg-panel px-2 py-1"
								value={target}
								onChange={(e) => setTarget(e.target.value as "all" | "selected")}
							>
								<option value="all">All lights</option>
								<option value="selected">Selected light</option>
							</select>
						</label>
						<label className="flex items-center justify-between">
							<span>Flash every</span>
							<select
								className="rounded border border-line bg-panel px-2 py-1"
								value={every}
								onChange={(e) => setEvery(Number(e.target.value))}
							>
								<option value={1}>beat</option>
								<option value={2}>2 beats</option>
								<option value={4}>4 beats (bar)</option>
							</select>
						</label>
						<div className="flex gap-2">
							<button className={`${small} flex-1`} disabled={!sel.beats} onClick={flash}>
								Add flashes
							</button>
							<button
								className={`${small} flex-1`}
								disabled={!sel.beats}
								onClick={() => {
									st().clearBeatClips(sel.id)
									setNote("Cleared the beat flashes.")
								}}
							>
								Clear flashes
							</button>
						</div>
					</div>
					{note && <p className="text-muted">{note}</p>}
				</section>
			)}
		</div>
	)
}

function ReferenceTab(): React.JSX.Element {
	const reference = useStore((s) => s.reference)
	const [busy, setBusy] = useState(false)
	const [note, setNote] = useState("")
	const st = useStore.getState

	const choose = async (): Promise<void> => {
		const p = await window.studio?.openVideo()
		if (!p) return
		setBusy(true)
		await loadReferenceFromPath(p, 0)
		setBusy(false)
	}

	const useSound = async (): Promise<void> => {
		setBusy(true)
		setNote("")
		const ok = await addReferenceAudio()
		setNote(
			ok
				? "The video's sound is on the Audio track, and the video's own sound is muted. Open the Audio tab to detect its beats."
				: "",
		)
		setBusy(false)
	}

	if (!reference) {
		return (
			<div className="space-y-3">
				<button className={`${small} w-full py-2`} disabled={busy} onClick={() => void choose()}>
					{busy ? "Opening…" : "Choose a video…"}
				</button>
				<p className="text-muted">
					Load concert footage to copy its lighting. It plays beside your stage, in step with the timeline.
					You can also drag a video onto the timeline.
				</p>
				<p className="text-muted">MP4 files (H.264 video, AAC sound) play best.</p>
			</div>
		)
	}

	const nudge = (d: number): void => st().updateReference({ start: Math.round((reference.start + d) * 100) / 100 })

	return (
		<div className="space-y-4">
			<section>
				<div className="truncate">{reference.name}</div>
				<div className="text-muted">{fmtLen(reference.duration)} long</div>
			</section>

			<section className="space-y-2">
				<label className="flex items-center justify-between">
					<span>Show the video</span>
					<input
						type="checkbox"
						checked={reference.visible}
						onChange={(e) => st().updateReference({ visible: e.target.checked })}
					/>
				</label>
				<label className="flex items-center justify-between">
					<span>Video sound</span>
					<select
						className="rounded border border-line bg-panel2 px-2 py-1"
						value={reference.muted ? "off" : "on"}
						onChange={(e) => st().updateReference({ muted: e.target.value === "off" })}
					>
						<option value="on">On</option>
						<option value="off">Off</option>
					</select>
				</label>
			</section>

			<section className="space-y-2 rounded border border-line bg-panel2 p-2">
				<h3 className="text-xs uppercase tracking-wider text-accent">Line it up</h3>
				<p className="text-muted">
					Where the video begins on the timeline. On the timeline you can drag the purple bar to move it, drag
					either edge to trim (cut an intro or outro), or hold Alt and drag to slide the video under the bar.
				</p>
				<p className="text-muted">
					Using {fmtLen(reference.trimIn)} to {fmtLen(reference.trimIn + reference.length)} of the{" "}
					{fmtLen(reference.duration)} video.
				</p>
				{(reference.trimIn > 0.005 || reference.length < reference.duration - 0.005) && (
					<button
						className={`${small} w-full`}
						onClick={() =>
							st().updateReference({
								start: Math.max(0, reference.start - reference.trimIn),
								trimIn: 0,
								length: reference.duration,
							})
						}
					>
						Reset trim (use the whole video)
					</button>
				)}
				<div className="flex items-center gap-1">
					<button className={small} onClick={() => nudge(-1)}>
						−1
					</button>
					<button className={small} onClick={() => nudge(-0.1)}>
						−.1
					</button>
					<input
						type="number"
						step={0.1}
						className="w-full min-w-0 rounded border border-line bg-panel px-2 py-1 text-center"
						value={reference.start}
						onChange={(e) => st().updateReference({ start: Number(e.target.value) || 0 })}
					/>
					<button className={small} onClick={() => nudge(0.1)}>
						+.1
					</button>
					<button className={small} onClick={() => nudge(1)}>
						+1
					</button>
				</div>
				<button
					className={`${small} w-full`}
					onClick={() => st().updateReference({ start: Math.round(st().playhead * 100) / 100 })}
				>
					Start the video at the playhead
				</button>
			</section>

			<section className="space-y-2 rounded border border-line bg-panel2 p-2">
				<h3 className="text-xs uppercase tracking-wider text-accent">Copy its lights</h3>
				<p className="text-muted">
					Put the video's sound on the timeline to get its waveform and beat detection, then build lights
					while you watch.
				</p>
				<button className={`${small} w-full`} disabled={busy} onClick={() => void useSound()}>
					{busy ? "Reading the sound…" : "Use the video's sound on the timeline"}
				</button>
				{note && <p className="text-muted">{note}</p>}
				<p className="text-muted">
					With Bluetooth speakers, use this instead of the video's own sound, so the Speaker delay slider can
					line the lights up with what you hear.
				</p>
			</section>

			<button className={`${small} w-full hover:text-red-400`} onClick={() => st().setReference(null)}>
				Remove the video
			</button>
		</div>
	)
}

function FixturesTab(): React.JSX.Element {
	const fixtures = useStore((s) => s.fixtures)
	const selectedId = useStore((s) => s.selectedId)
	const add = useStore((s) => s.addFixture)
	const select = useStore((s) => s.selectFixture)
	const remove = useStore((s) => s.removeFixture)

	return (
		<div className="space-y-4">
			<section>
				<h3 className="mb-2 text-xs uppercase tracking-wider text-muted">Add a light</h3>
				<div className="space-y-1">
					{PROFILES.map((p) => (
						<button
							key={p.id}
							className="flex w-full items-center justify-between rounded border border-line bg-panel2 px-2 py-2 text-left hover:border-accent"
							onClick={() => add(p.id)}
						>
							<span>{p.name}</span>
							<span className="text-muted">+ {p.channels.length}ch</span>
						</button>
					))}
				</div>
			</section>
			<section>
				<h3 className="mb-2 text-xs uppercase tracking-wider text-muted">On stage</h3>
				{fixtures.length === 0 && <p className="text-muted">No lights yet. Add one above.</p>}
				<div className="space-y-1">
					{fixtures.map((f) => {
						const n = profileById(f.profileId).channels.length
						return (
							<div
								key={f.id}
								className={`flex items-center justify-between rounded border px-2 py-2 ${f.id === selectedId ? "border-accent bg-panel2" : "border-line"}`}
								onClick={() => select(f.id)}
							>
								<div>
									<div>{f.name}</div>
									<div className="text-muted">
										Set the light to address <b className="text-white">{f.address}</b> (ch {f.address}–
										{f.address + n - 1})
									</div>
								</div>
								<button
									className="px-2 text-muted hover:text-red-400"
									onClick={(e) => {
										e.stopPropagation()
										remove(f.id)
									}}
								>
									✕
								</button>
							</div>
						)
					})}
				</div>
			</section>
		</div>
	)
}
