import { useEffect, useRef } from "react"

import { cleanProjection } from "../lib/projection"
import { ProjectionRenderer } from "../lib/projectionRenderer"

/**
 * What the projector window shows: the masked, warped visuals on pure black and nothing else, no cursor and
 * no handles. It has no show of its own; the main window sends it the setup whenever that changes.
 */
export function ProjectionOutput(): React.JSX.Element {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		let renderer: ProjectionRenderer
		try {
			renderer = new ProjectionRenderer(canvas)
		} catch {
			return
		}
		const apply = (json: string | null): void => {
			if (!json) return
			try {
				renderer.setScene(cleanProjection(JSON.parse(json)))
			} catch {
				// a garbled message just keeps the last good picture
			}
		}
		renderer.start()
		void window.studio?.projectionGet().then(apply)
		const off = window.studio?.onProjectionState(apply)
		return () => {
			off?.()
			renderer.dispose()
		}
	}, [])

	return (
		<div className="fixed inset-0 bg-black" style={{ cursor: "none" }}>
			<canvas ref={canvasRef} className="block h-full w-full" />
		</div>
	)
}
