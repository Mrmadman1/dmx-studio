import { useEffect, useRef } from "react"

import { effectiveValues } from "../lib/show"
import { lightTime, previewColor, useStore } from "../lib/store"

const MAX_SLOT = 140

/** Width of one light's slot: full size when there's room, shrinking to fit when there isn't. */
const slotWidth = (n: number, width: number): number => Math.min(MAX_SLOT, width / Math.max(n, 1))

/** Slot centre for fixture i of n, laid out in one centred row. */
function slotX(i: number, n: number, width: number): number {
	const sw = slotWidth(n, width)
	return (width - n * sw) / 2 + i * sw + sw / 2
}

export function StagePreview(): React.JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = ref.current
		if (!canvas) return
		const ctx = canvas.getContext("2d")
		if (!ctx) return
		let raf = 0
		const draw = (): void => {
			const dpr = window.devicePixelRatio || 1
			const w = canvas.clientWidth
			const h = canvas.clientHeight
			if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
				canvas.width = Math.round(w * dpr)
				canvas.height = Math.round(h * dpr)
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			ctx.fillStyle = "#0b0b0d"
			ctx.fillRect(0, 0, w, h)
			const state = useStore.getState()
			const { fixtures, selectedId, blackout, mode } = state
			const clips = mode === "timeline" ? state.clips : []
			const playhead = lightTime(state)
			// scale everything with the slot so lights shrink instead of overlapping or clipping
			const k = Math.max(0.35, Math.min(slotWidth(fixtures.length, w) / MAX_SLOT, (h * 0.5) / 120))
			fixtures.forEach((f, i) => {
				const cx = slotX(i, fixtures.length, w)
				const cy = h * 0.5
				const c = previewColor(f, effectiveValues(f, clips, playhead))
				const lit = blackout ? 0 : c.intensity
				const rgb = `${c.r},${c.g},${c.b}`
				// glow
				const glow = ctx.createRadialGradient(cx, cy, 10 * k, cx, cy, 110 * k)
				glow.addColorStop(0, `rgba(${rgb},${0.75 * lit})`)
				glow.addColorStop(1, `rgba(${rgb},0)`)
				ctx.fillStyle = glow
				ctx.fillRect(cx - 120 * k, cy - 120 * k, 240 * k, 240 * k)
				// lamp body
				ctx.fillStyle = "#26262b"
				ctx.beginPath()
				ctx.arc(cx, cy, 34 * k, 0, Math.PI * 2)
				ctx.fill()
				ctx.fillStyle = `rgb(${Math.round(c.r * lit)},${Math.round(c.g * lit)},${Math.round(c.b * lit)})`
				ctx.beginPath()
				ctx.arc(cx, cy, 26 * k, 0, Math.PI * 2)
				ctx.fill()
				if (f.id === selectedId) {
					ctx.strokeStyle = "#19d3c5"
					ctx.lineWidth = 2
					ctx.beginPath()
					ctx.arc(cx, cy, 40 * k, 0, Math.PI * 2)
					ctx.stroke()
				}
				ctx.fillStyle = "#8b8b95"
				ctx.font = `${Math.max(10, 12 * k)}px system-ui`
				ctx.textAlign = "center"
				ctx.fillText(f.name, cx, cy + 62 * k)
				ctx.fillText(`addr ${f.address}`, cx, cy + 62 * k + Math.max(12, 16 * k))
			})
			if (fixtures.length === 0) {
				ctx.fillStyle = "#55555e"
				ctx.font = "14px system-ui"
				ctx.textAlign = "center"
				ctx.fillText("Add a light from the Fixtures tab", w / 2, h / 2)
			}
			raf = requestAnimationFrame(draw)
		}
		raf = requestAnimationFrame(draw)
		return () => cancelAnimationFrame(raf)
	}, [])

	const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
		const rect = e.currentTarget.getBoundingClientRect()
		const { fixtures, selectFixture } = useStore.getState()
		const x = e.clientX - rect.left
		const half = slotWidth(fixtures.length, rect.width) / 2
		const hit = fixtures.findIndex((_f, i) => Math.abs(x - slotX(i, fixtures.length, rect.width)) < half)
		if (hit >= 0) selectFixture(fixtures[hit].id)
	}

	return (
		<main className="min-h-0 min-w-0 flex-1 bg-bg">
			<canvas ref={ref} className="h-full w-full" onClick={onClick} />
		</main>
	)
}
