// DMX512 output over an FTDI/RS485 "Open DMX"-style USB cable, in its OWN PROCESS
// (an Electron utilityProcess, started by dmx.cjs). The computer generates the timing:
// BREAK, MAB, then start code + 512 slots at 250000 baud 8N2, repeated ~40 times a
// second. Running here keeps it off the thread Electron uses for window/UI work, which
// Windows slows down when the app is behind another window.
const os = require("node:os")
const { SerialPort } = require("serialport")

const FRAME_MS = 25 // 40 Hz target; the 513-byte write itself takes ~23 ms
const BREAK_MS = 0.3 // spec minimum is 88us

try {
	os.setPriority(0, os.constants.priority.PRIORITY_HIGH)
} catch {
	// not allowed here: carry on at normal priority
}

// slot 0 is the start code (always 0); slots 1..512 are filled by "frame" messages
const frame = Buffer.alloc(513)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const spin = (ms) => {
	const end = performance.now() + ms
	while (performance.now() < end) {
		// busy-wait: only used for the sub-millisecond break, in this dedicated process
	}
}
// Windows rounds setTimeout up to ~15.6ms, so waits under ~20ms yield in a loop instead.
async function preciseWait(ms) {
	const end = performance.now() + ms
	if (ms > 20) await sleep(ms - 10)
	while (performance.now() < end) await new Promise((r) => setImmediate(r))
}

let port = null
let running = false

const status = (s) => process.parentPort.postMessage({ type: "status", status: s })

function fail(err) {
	running = false
	port = null
	status({ state: "error", message: String(err.message ?? err) })
}

async function list() {
	const ports = await SerialPort.list()
	return ports.map((p) => ({
		path: p.path,
		manufacturer: p.manufacturer ?? "",
		vendorId: p.vendorId ?? "",
		productId: p.productId ?? "",
	}))
}

async function disconnect() {
	running = false
	const p = port
	port = null
	if (p?.isOpen) await new Promise((res) => p.close(() => res()))
	status({ state: "disconnected" })
}

async function connect(path) {
	await disconnect()
	const p = new SerialPort({
		path,
		baudRate: 250000,
		dataBits: 8,
		stopBits: 2,
		parity: "none",
		autoOpen: false,
	})
	await new Promise((res, rej) => p.open((e) => (e ? rej(e) : res())))
	p.on("error", (e) => fail(e))
	p.on("close", () => {
		if (port === p) fail(new Error("Port closed (cable unplugged?)"))
	})
	port = p
	running = true
	status({ state: "connected", path })
	void loop(p)
	return { ok: true }
}

async function loop(p) {
	const set = (o) => new Promise((res, rej) => p.set(o, (e) => (e ? rej(e) : res())))
	const write = (b) => new Promise((res, rej) => p.write(b, (e) => (e ? rej(e) : res())))
	const drain = () => new Promise((res, rej) => p.drain((e) => (e ? rej(e) : res())))
	let frames = 0
	let windowStart = performance.now()
	let lastStart = 0
	let worst = 0
	while (running && port === p) {
		const t0 = performance.now()
		if (lastStart) worst = Math.max(worst, t0 - lastStart)
		lastStart = t0
		try {
			await set({ brk: true })
			spin(BREAK_MS)
			await set({ brk: false })
			await write(Buffer.from(frame)) // snapshot, so a mid-write update can't tear the frame
			await drain()
		} catch (e) {
			fail(e)
			return
		}
		frames++
		const now = performance.now()
		if (now - windowStart >= 1000) {
			status({ state: "connected", path: p.path, fps: frames, worstMs: Math.round(worst) })
			frames = 0
			worst = 0
			windowStart = now
		}
		const wait = FRAME_MS - (performance.now() - t0)
		if (wait > 0) await preciseWait(wait)
	}
}

const ops = { list, connect, disconnect }

process.parentPort.on("message", async ({ data }) => {
	const { id, op, arg } = data
	if (op === "frame") {
		const n = Math.min(arg.length, 512)
		for (let i = 0; i < n; i++) frame[i + 1] = arg[i]
		return
	}
	try {
		const result = await ops[op](arg)
		process.parentPort.postMessage({ type: "reply", id, result })
	} catch (e) {
		process.parentPort.postMessage({ type: "reply", id, error: String(e.message ?? e) })
	}
})
