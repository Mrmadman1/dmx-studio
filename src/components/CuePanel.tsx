import { useStore } from "../lib/store"

const btn =
	"rounded border border-line bg-panel2 px-2 py-1 hover:bg-line disabled:opacity-40 disabled:hover:bg-panel2"

export function CuePanel(): React.JSX.Element {
	const cues = useStore((s) => s.cues)
	const currentCue = useStore((s) => s.currentCue)
	const selectedCueId = useStore((s) => s.selectedCueId)
	const hasFixtures = useStore((s) => s.fixtures.length > 0)
	const st = useStore.getState

	const next = cues[currentCue + 1]
	const selected = cues.find((c) => c.id === selectedCueId)

	return (
		<section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
				<button
					className="min-w-40 rounded bg-accent px-4 py-1.5 text-sm font-bold text-black disabled:opacity-40"
					disabled={!next}
					onClick={() => st().goNext()}
					title="Go to the next cue (Space)"
				>
					{next ? `GO ▶  ${next.name}` : cues.length ? "End of list" : "GO"}
				</button>
				<button className={btn} disabled={currentCue <= 0} onClick={() => st().goBack()} title="Back one cue (←)">
					◀ Back
				</button>
				<span className="mx-1 h-5 w-px bg-line" />
				<button
					className={btn}
					disabled={!hasFixtures}
					onClick={() => st().recordCue()}
					title="Save what the lights are doing right now as a new cue"
				>
					● Record cue
				</button>
				<button
					className={btn}
					disabled={!selected}
					onClick={() => selected && st().updateCueLook(selected.id)}
					title="Overwrite the selected cue with what the lights are doing now"
				>
					Update selected
				</button>
				<div className="flex-1" />
				<span className="text-muted">Space = next cue · ← back</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{cues.length === 0 && (
					<p className="p-2 text-muted">
						{hasFixtures
							? "Set your lights how you want them, then press “Record cue”. Repeat for each look, then use Space to step through them."
							: "Add a light in the Fixtures tab, set it up, then press “Record cue”."}
					</p>
				)}
				<div className="space-y-1">
					{cues.map((c, i) => {
						const live = i === currentCue
						return (
							<div
								key={c.id}
								className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${
									live ? "border-accent bg-panel2" : c.id === selectedCueId ? "border-muted" : "border-line"
								}`}
								onClick={() => st().selectCue(c.id)}
							>
								<span className="w-6 text-right tabular-nums text-muted">{i + 1}</span>
								<input
									className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1"
									value={c.name}
									onChange={(e) => st().updateCue(c.id, { name: e.target.value })}
								/>
								<label className="flex items-center gap-1 text-muted">
									Fade
									<input
										type="number"
										min={0}
										step={0.1}
										className="w-16 rounded border border-line bg-panel px-2 py-1 text-white"
										value={c.fade}
										onChange={(e) => st().updateCue(c.id, { fade: Number(e.target.value) || 0 })}
									/>
									s
								</label>
								<span className="w-12 text-center text-[10px] font-bold">
									{live && <span className="text-accent">LIVE</span>}
									{i === currentCue + 1 && <span className="text-muted">NEXT</span>}
								</span>
								<button
									className={btn}
									title="Go to this cue now"
									onClick={(e) => {
										e.stopPropagation()
										st().goCue(i)
									}}
								>
									▶
								</button>
								<button
									className={btn}
									disabled={i === 0}
									onClick={(e) => {
										e.stopPropagation()
										st().moveCue(c.id, -1)
									}}
								>
									↑
								</button>
								<button
									className={btn}
									disabled={i === cues.length - 1}
									onClick={(e) => {
										e.stopPropagation()
										st().moveCue(c.id, 1)
									}}
								>
									↓
								</button>
								<button
									className={`${btn} hover:text-red-400`}
									onClick={(e) => {
										e.stopPropagation()
										st().removeCue(c.id)
									}}
								>
									✕
								</button>
							</div>
						)
					})}
				</div>
			</div>
		</section>
	)
}
