import type { Mat3, ProjLayer, Projection, ProjSource } from "./projection"

import { layerInverse } from "./projection"

/**
 * Draws a Projection with WebGL, one full-screen pass per layer, bottom to top, over black.
 *
 * Each pass: for every output pixel, the layer's inverse corner-pin matrix gives the spot in the source
 * video it should show (outside the quad: nothing), and the layer's mask texture (a polygon, blurred by
 * the feather) is the alpha. Additive layers blend their video in; hole layers blend black in, which
 * cuts away whatever is beneath. The same renderer drives the editor preview and the projector window.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vOut;
void main() {
	// vOut: 0..1 across and down the picture (y down), the space the layers are stored in
	vOut = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
	gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vOut;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform mat3 uInv;
uniform float uHole;
uniform float uUseQuad;
uniform float uSign;
void main() {
	vec3 q = uInv * vec3(vOut, 1.0);
	vec2 uv = q.xy / q.z;
	float inQuad = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, q.z * uSign);
	float m = uUseQuad > 0.5 ? 1.0 : texture2D(uMask, vOut).a;
	if (uHole > 0.5) {
		gl_FragColor = vec4(0.0, 0.0, 0.0, m);
	} else {
		vec3 c = texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb;
		gl_FragColor = vec4(c, m * inQuad);
	}
}`

/** column-major for WebGL, from our row-major matrix */
const toGl = (m: Mat3): Float32Array => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])

interface Live {
	el: HTMLVideoElement
	stream?: MediaStream
	texture: WebGLTexture | null
	key: string
}

interface MaskTex {
	texture: WebGLTexture
	key: string
}

/** whether a layer's mask is a usable closed polygon */
export function hasShape(l: ProjLayer): boolean {
	return l.closed && l.mask.length >= 3
}

export class ProjectionRenderer {
	private gl: WebGLRenderingContext
	private program: WebGLProgram
	private loc: Record<string, WebGLUniformLocation | null> = {}
	private scene: Projection = { width: 1920, height: 1080, sources: [], layers: [] }
	private live = new Map<string, Live>()
	private masks = new Map<string, MaskTex>()
	private black: WebGLTexture
	private maskCanvas = document.createElement("canvas")
	private raf = 0
	private disposed = false
	/** called with a message when a source can't be played (missing file, camera refused) */
	onSourceError: (sourceId: string, message: string) => void = () => {}

	constructor(private canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
		if (!gl) throw new Error("WebGL isn't available on this machine")
		this.gl = gl
		const compile = (type: number, src: string): WebGLShader => {
			const sh = gl.createShader(type) as WebGLShader
			gl.shaderSource(sh, src)
			gl.compileShader(sh)
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader failed")
			return sh
		}
		const prog = gl.createProgram() as WebGLProgram
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
		gl.linkProgram(prog)
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed")
		this.program = prog
		gl.useProgram(prog)
		for (const n of ["uVideo", "uMask", "uInv", "uHole", "uUseQuad", "uSign"]) this.loc[n] = gl.getUniformLocation(prog, n)
		const buf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buf)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		const aPos = gl.getAttribLocation(prog, "aPos")
		gl.enableVertexAttribArray(aPos)
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		this.black = this.makeTexture()
		gl.bindTexture(gl.TEXTURE_2D, this.black)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
	}

	private makeTexture(): WebGLTexture {
		const gl = this.gl
		const t = gl.createTexture() as WebGLTexture
		gl.bindTexture(gl.TEXTURE_2D, t)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		return t
	}

	setScene(scene: Projection): void {
		this.scene = scene
		const wanted = new Set(scene.layers.filter((l) => l.mode === "add" && l.sourceId).map((l) => l.sourceId as string))
		for (const src of scene.sources) if (wanted.has(src.id)) void this.ensureSource(src)
		// let go of sources no layer uses any more (a camera stays on only while it's needed)
		for (const id of [...this.live.keys()]) if (!wanted.has(id) || !scene.sources.some((s) => s.id === id)) this.dropSource(id)
		for (const id of [...this.masks.keys()]) {
			if (!scene.layers.some((l) => l.id === id)) {
				this.gl.deleteTexture(this.masks.get(id)?.texture ?? null)
				this.masks.delete(id)
			}
		}
	}

	private sourceKey(s: ProjSource): string {
		return `${s.kind}|${s.path ?? ""}|${s.deviceId ?? ""}`
	}

	private async ensureSource(src: ProjSource): Promise<void> {
		const key = this.sourceKey(src)
		const have = this.live.get(src.id)
		if (have && have.key === key) return
		if (have) this.dropSource(src.id)
		const el = document.createElement("video")
		el.muted = true
		el.loop = true
		el.playsInline = true
		el.crossOrigin = "anonymous"
		const entry: Live = { el, texture: null, key }
		this.live.set(src.id, entry) // claim the slot first so a second setScene doesn't open it twice
		try {
			if (src.kind === "camera") {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: src.deviceId ? { deviceId: { exact: src.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : true,
					audio: false,
				})
				if (this.disposed || this.live.get(src.id) !== entry) {
					for (const t of stream.getTracks()) t.stop()
					return
				}
				entry.stream = stream
				el.srcObject = stream
			} else {
				const url = src.path ? await window.studio?.mediaUrl(src.path) : null
				if (this.disposed || this.live.get(src.id) !== entry) return
				if (!url) throw new Error("The video file is missing")
				el.src = url
			}
			await el.play()
		} catch (err) {
			if (this.live.get(src.id) === entry) this.onSourceError(src.id, err instanceof Error ? err.message : String(err))
		}
	}

	private dropSource(id: string): void {
		const l = this.live.get(id)
		if (!l) return
		l.el.pause()
		l.el.removeAttribute("src")
		l.el.srcObject = null
		l.el.load()
		for (const t of l.stream?.getTracks() ?? []) t.stop()
		if (l.texture) this.gl.deleteTexture(l.texture)
		this.live.delete(id)
	}

	/** the mask as an alpha texture: the polygon filled, then blurred by the feather */
	private maskTexture(l: ProjLayer, w: number, h: number): WebGLTexture | null {
		if (!hasShape(l)) return null
		const key = `${w}x${h}|${l.feather}|${l.mask.map((p) => `${p[0]},${p[1]}`).join(";")}`
		const have = this.masks.get(l.id)
		if (have && have.key === key) return have.texture
		const c = this.maskCanvas
		c.width = w
		c.height = h
		const ctx = c.getContext("2d") as CanvasRenderingContext2D
		ctx.clearRect(0, 0, w, h)
		const blur = (l.feather * (h / 1080)) / 2
		ctx.filter = blur > 0.25 ? `blur(${blur}px)` : "none"
		ctx.fillStyle = "#fff"
		ctx.beginPath()
		l.mask.forEach((p, i) => (i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h)))
		ctx.closePath()
		ctx.fill()
		ctx.filter = "none"
		const gl = this.gl
		const tex = have?.texture ?? this.makeTexture()
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
		this.masks.set(l.id, { texture: tex, key })
		return tex
	}

	private videoTexture(id: string): WebGLTexture {
		const l = this.live.get(id)
		if (!l || l.el.readyState < 2 || !l.el.videoWidth) return this.black
		const gl = this.gl
		if (!l.texture) l.texture = this.makeTexture()
		gl.bindTexture(gl.TEXTURE_2D, l.texture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, l.el)
		return l.texture
	}

	/** keep the drawing buffer matched to the size it's shown at */
	private fit(): void {
		const dpr = window.devicePixelRatio || 1
		const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr))
		const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr))
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w
			this.canvas.height = h
		}
	}

	render(): void {
		if (this.disposed) return
		const gl = this.gl
		this.fit()
		const w = this.canvas.width
		const h = this.canvas.height
		gl.viewport(0, 0, w, h)
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT)
		gl.useProgram(this.program)
		gl.uniform1i(this.loc.uVideo, 0)
		gl.uniform1i(this.loc.uMask, 1)
		for (const layer of this.scene.layers) {
			const inv = layerInverse(layer.corners)
			const isHole = layer.mode === "hole"
			if (!inv) continue
			if (isHole && !hasShape(layer)) continue
			if (!isHole && (!layer.sourceId || !this.live.has(layer.sourceId))) continue
			const mask = this.maskTexture(layer, w, h)
			gl.activeTexture(gl.TEXTURE0)
			gl.bindTexture(gl.TEXTURE_2D, isHole ? this.black : this.videoTexture(layer.sourceId as string))
			gl.activeTexture(gl.TEXTURE1)
			gl.bindTexture(gl.TEXTURE_2D, mask ?? this.black)
			gl.uniformMatrix3fv(this.loc.uInv, false, toGl(inv))
			// which side of the quad's horizon is "in front": the quad's own centre is, whatever the matrix's overall sign
			const cx = (layer.corners[0][0] + layer.corners[1][0] + layer.corners[2][0] + layer.corners[3][0]) / 4
			const cy = (layer.corners[0][1] + layer.corners[1][1] + layer.corners[2][1] + layer.corners[3][1]) / 4
			gl.uniform1f(this.loc.uSign, inv[6] * cx + inv[7] * cy + inv[8] >= 0 ? 1 : -1)
			gl.uniform1f(this.loc.uHole, isHole ? 1 : 0)
			// no usable mask: an additive layer shows its whole quad
			gl.uniform1f(this.loc.uUseQuad, mask ? 0 : 1)
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
		}
		gl.activeTexture(gl.TEXTURE0)
	}

	start(): void {
		const loop = (): void => {
			if (this.disposed) return
			this.render()
			this.raf = requestAnimationFrame(loop)
		}
		cancelAnimationFrame(this.raf)
		this.raf = requestAnimationFrame(loop)
	}

	dispose(): void {
		this.disposed = true
		cancelAnimationFrame(this.raf)
		for (const id of [...this.live.keys()]) this.dropSource(id)
		this.gl.getExtension("WEBGL_lose_context")?.loseContext()
	}
}
