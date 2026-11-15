import { useEffect, useState } from "react"

import { useStore } from "../lib/store"

const SEEN_KEY = "dmx-studio-welcome-seen"

/** Whether the welcome guide has been shown before (browser storage can be unavailable, so never trust it to work). */
export function welcomeSeen(): boolean {
	try {
		return window.localStorage.getItem(SEEN_KEY) === "1"
	} catch {
		return true
	}
}

function markSeen(): void {
	try {
		window.localStorage.setItem(SEEN_KEY, "1")
	} catch {
		// nothing to do: the guide just opens again next time
	}
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }): React.JSX.Element => (
	<li className="flex gap-3">
		<span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-black">{n}</span>
		<span>{children}</span>
	</li>
)

const Key = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
	<kbd className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-xs text-white">{children}</kbd>
)

const Tip = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
	<p className="rounded border-l-2 border-accent bg-panel2 px-3 py-2 text-muted">{children}</p>
)

interface Section {
	id: string
	title: string
	body: (go: (id: string) => void) => React.JSX.Element
}

export function HelpGuide(): React.JSX.Element | null {
	const open = useStore((s) => s.helpOpen)
	const setOpen = useStore((s) => s.setHelpOpen)
	const addFixture = useStore((s) => s.addFixture)
	const setWorkspace = useStore((s) => s.setWorkspace)
	const hasLights = useStore((s) => s.fixtures.length > 0)
	const [page, setPage] = useState("start")

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [open, setOpen])

	if (!open) return null

	const close = (): void => {
		markSeen()
		setOpen(false)
	}

	const btn = "rounded bg-accent px-3 py-1.5 font-medium text-black hover:opacity-90"
	const ghost = "rounded border border-line bg-panel2 px-3 py-1.5 hover:bg-line"

	const sections: Section[] = [
		{
			id: "start",
			title: "Start here",
			body: (go) => (
				<>
					<h2 className="text-lg font-semibold text-white">Welcome to DMX Studio</h2>
					<p>
						This app plays a <b className="text-white">light show</b>: you line up colours and effects on a timeline, add music if you like, and your real lights follow along. You can also
						project video onto walls and objects.
					</p>
					<ol className="space-y-3">
						<Step n={1}>
							<b className="text-white">Plug in your USB-DMX cable</b> and press <b className="text-white">Connect</b> at the top right. (No cable yet? You can still build a show. The
							picture in the middle shows what your lights will do.)
						</Step>
						<Step n={2}>
							<b className="text-white">Add your lights</b> in the <b className="text-white">Fixtures</b> tab on the left, then set each real light to the{" "}
							<button className="text-accent underline" onClick={() => go("address")}>
								address
							</button>{" "}
							the app tells you.
						</Step>
						<Step n={3}>
							<b className="text-white">Make the show</b>: pick a ready-made look in the <b className="text-white">Effects</b> tab, or add your own colour blocks with{" "}
							<b className="text-white">+ Clip</b> on the timeline at the bottom.
						</Step>
						<Step n={4}>
							Press <b className="text-white">Play</b> (or the space bar). Made a mistake? <Key>Ctrl</Key>+<Key>Z</Key> undoes it.
						</Step>
					</ol>
					<div className="flex flex-wrap gap-2 pt-1">
						{!hasLights && (
							<button
								className={btn}
								onClick={() => {
									addFixture("par7")
									close()
								}}
							>
								Add a first light for me
							</button>
						)}
						<button className={ghost} onClick={() => go("trouble")}>
							My light does nothing
						</button>
						<button
							className={ghost}
							onClick={() => {
								setWorkspace("projection")
								close()
							}}
						>
							Show me projection mapping
						</button>
					</div>
				</>
			),
		},
		{
			id: "address",
			title: "Your lights and addresses",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Lights, channels and addresses</h2>
					<p>
						Lights on one cable all hear the same signal, so each light is told <b className="text-white">which numbers to listen to</b>. That number is its{" "}
						<b className="text-white">DMX address</b>.
					</p>
					<p>
						A basic colour light uses 7 numbers (<b className="text-white">channels</b>): brightness, red, green, blue, strobe and so on. So the first light listens from 1, the next
						from 8, then 15. The app picks these for you.
					</p>
					<Tip>
						The important part: look at the <b className="text-white">Fixtures</b> tab. It says, for example, “Set the light to address 8”. Do exactly that on the real light, with its
						little screen and buttons or its dip switches. If the numbers don't match, the light ignores the show.
					</Tip>
					<p>
						Two lights set to the same address do exactly the same thing, which is handy for matching pairs. Changed your mind? Click the light and change its{" "}
						<b className="text-white">DMX start address</b> on the right.
					</p>
				</>
			),
		},
		{
			id: "timeline",
			title: "The timeline",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Building a show on the timeline</h2>
					<p>
						Each light has its own <b className="text-white">row</b>. Time runs left to right. A coloured block (a <b className="text-white">clip</b>) means “this light is this colour
						for this long”.
					</p>
					<ul className="list-disc space-y-2 pl-5">
						<li>
							<b className="text-white">+ Clip</b> adds a block to the selected light. Drag it to move it, drag its edges to make it longer or shorter.
						</li>
						<li>
							Click a block to change its colour, brightness, fade in/out or strobe on the right.
						</li>
						<li>
							<b className="text-white">Split</b> (<Key>S</Key>) cuts a block in two at the red playhead line. <b className="text-white">Copy / Paste / Duplicate</b> work like in any
							app.
						</li>
						<li>
							Drag on empty space to select several blocks at once, then move or copy them together.
						</li>
						<li>
							<b className="text-white">+ Accent</b> (or tap <Key>A</Key> while the song plays) adds a quick brightness flash on a beat.
						</li>
						<li>
							<b className="text-white">+ Audio</b> adds a song. In the <b className="text-white">Audio</b> tab, “Detect beats” lets lights flash with the music.
						</li>
						<li>
							<b className="text-white">Undo</b> and <b className="text-white">Redo</b> are in the toolbar too.
						</li>
					</ul>
				</>
			),
		},
		{
			id: "effects",
			title: "Ready-made effects",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Effects: instant looks</h2>
					<p>
						Don't want to place every block yourself? Open the <b className="text-white">Effects</b> tab, click one (like <b className="text-white">Rainbow Chase</b> or{" "}
						<b className="text-white">Police Strobe</b>), choose where it starts and how long it lasts, tick the lights to use, and press the button at the bottom.
					</p>
					<Tip>
						An effect just drops ordinary blocks onto your timeline, so you can still edit them afterwards. If you pick “Replace what's already there” it clears that stretch first, and{" "}
						<Key>Ctrl</Key>+<Key>Z</Key> brings it back.
					</Tip>
					<p>
						Added too many? The effect is listed under <b className="text-white">On your timeline</b> with a Remove button.
					</p>
				</>
			),
		},
		{
			id: "heads",
			title: "Moving heads",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Moving heads (lights that turn)</h2>
					<p>
						A moving head has a <b className="text-white">Movement</b> row under its track. Each diamond is a <b className="text-white">pose</b>: where the light points at that moment.
						Add one with <b className="text-white">+ Frame</b> (or <Key>K</Key>); the head then swings smoothly from pose to pose.
					</p>
					<p>
						Real motors can't teleport, so the app limits how fast the head turns. A red warning on a pose means the head won't make it in time: give it more time or a shorter turn.
					</p>
				</>
			),
		},
		{
			id: "projection",
			title: "Projection mapping",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Putting video onto a wall or object</h2>
					<p>Open the <b className="text-white">Projection</b> tab at the top. A checklist on the left walks you through it:</p>
					<ol className="space-y-3">
						<Step n={1}>
							<b className="text-white">Add a video</b> (a file, or a live camera). It appears as a picture straight away.
						</Step>
						<Step n={2}>
							<b className="text-white">Fit to surface</b>: drag the four square corner handles until the picture lines up with the real wall, screen or object. This is how a flat picture
							gets bent to match an angled surface.
						</Step>
						<Step n={3}>
							Optional: switch to <b className="text-white">Cut-out shape</b> and click points to outline just the part you want lit, such as a window. Use{" "}
							<b className="text-white">Hide an area</b> to keep video off a spot (a door, a person).
						</Step>
						<Step n={4}>
							Press <b className="text-white">Send to projector</b>. A full-screen window appears on the screen you picked. Press <Key>Esc</Key> on it to close it.
						</Step>
					</ol>
					<Tip>Use <b className="text-white">Clean view</b> to see exactly what the projector shows, without any handles or lines.</Tip>
				</>
			),
		},
		{
			id: "trouble",
			title: "If something's wrong",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">If something's not working</h2>
					<div className="space-y-4">
						<div>
							<b className="text-white">My light does nothing</b>
							<ul className="mt-1 list-disc space-y-1 pl-5">
								<li>Press <b className="text-white">Test lights</b> at the top. Every light should turn bright white. If not, it's the cable, address or mode, not your show.</li>
								<li>Check the top right says <b className="text-white">Connected</b> and the right COM port is chosen.</li>
								<li>
									Check the light's address matches what the <b className="text-white">Fixtures</b> tab says, and that the light is in its “DMX” or “7 channel” mode.
								</li>
							</ul>
						</div>
						<div>
							<b className="text-white">The light flickers</b>
							<p className="mt-1">Try a shorter cable, and plug a DMX “terminator” into the last light in the chain if you have one.</p>
						</div>
						<div>
							<b className="text-white">No COM port in the list</b>
							<p className="mt-1">Unplug and replug the cable, press Refresh, and check Windows Device Manager shows it under “Ports”.</p>
						</div>
						<div>
							<b className="text-white">The lights are late compared to the music</b>
							<p className="mt-1">Bluetooth speakers play late. Raise <b className="text-white">Speaker delay</b> in the timeline toolbar until they line up.</p>
						</div>
					</div>
				</>
			),
		},
		{
			id: "keys",
			title: "Shortcuts",
			body: () => (
				<>
					<h2 className="text-lg font-semibold text-white">Keyboard shortcuts</h2>
					<table className="w-full">
						<tbody>
							{(
								[
									["Space", "Play / pause (in Cues: go to the next cue)"],
									["Ctrl + Z", "Undo"],
									["Ctrl + Y  or  Ctrl + Shift + Z", "Redo"],
									["Ctrl + C / X / V", "Copy / cut / paste on the timeline"],
									["Ctrl + D", "Duplicate the selection"],
									["Ctrl + A", "Select everything"],
									["S", "Split the selected blocks at the playhead"],
									["A", "Add a brightness flash at the playhead"],
									["K", "Add a pose for the selected moving head"],
									["Delete", "Delete the selection"],
									["Home", "Jump to the start"],
								] as const
							).map(([k, d]) => (
								<tr key={k} className="border-b border-line">
									<td className="py-2 pr-4 whitespace-nowrap text-white">{k}</td>
									<td className="py-2">{d}</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			),
		},
	]

	const current = sections.find((s) => s.id === page) ?? sections[0]

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close}>
			<div className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
				<nav className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-bg p-3">
					<div className="mb-2 text-xs uppercase tracking-wide text-muted">Guide</div>
					{sections.map((s) => (
						<button
							key={s.id}
							className={`rounded px-2 py-1.5 text-left ${page === s.id ? "bg-accent font-medium text-black" : "hover:bg-line"}`}
							onClick={() => setPage(s.id)}
						>
							{s.title}
						</button>
					))}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex-1 space-y-4 overflow-y-auto p-6 leading-relaxed text-[#cfcfd6]">{current.body(setPage)}</div>
					<div className="flex items-center justify-between border-t border-line px-6 py-3">
						<span className="text-muted">You can reopen this any time with the Help button at the top.</span>
						<button className={btn} onClick={close}>
							Got it
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
