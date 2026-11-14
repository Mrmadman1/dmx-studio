// Main-process handle to the DMX engine, which runs in dmx-worker.cjs as its own
// process (an Electron utilityProcess; native serial code can't run in a worker thread).
// Must be constructed after app.whenReady().
const path = require("node:path")
const { utilityProcess } = require("electron")

class DmxEngine {
	constructor(onStatus) {
		this.onStatus = onStatus
		this.pending = new Map()
		this.nextId = 1
		this.child = utilityProcess.fork(path.join(__dirname, "dmx-worker.cjs"), [], {
			serviceName: "dmx",
			stdio: "inherit",
		})
		this.child.on("message", (m) => {
			if (m.type === "status") {
				onStatus(m.status)
			} else if (m.type === "reply") {
				const p = this.pending.get(m.id)
				this.pending.delete(m.id)
				if (!p) return
				if (m.error) p.reject(new Error(m.error))
				else p.resolve(m.result)
			}
		})
		this.child.on("exit", (code) => {
			for (const p of this.pending.values()) p.reject(new Error("DMX process exited"))
			this.pending.clear()
			if (!this.disposed) onStatus({ state: "error", message: `DMX process exited (code ${code})` })
		})
	}

	call(op, arg) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++
			this.pending.set(id, { resolve, reject })
			this.child.postMessage({ id, op, arg })
		})
	}

	list() {
		return this.call("list")
	}

	connect(portPath) {
		return this.call("connect", portPath)
	}

	disconnect() {
		return this.call("disconnect")
	}

	setFrame(slots) {
		this.child.postMessage({ op: "frame", arg: slots })
	}

	dispose() {
		this.disposed = true
		this.child.kill()
	}
}

module.exports = { DmxEngine }
