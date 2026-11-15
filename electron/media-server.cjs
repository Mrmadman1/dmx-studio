// A tiny localhost-only HTTP server that streams media files the user has picked (a reference
// video, a song) to the app's page. <video> needs byte-range requests to seek in a big concert
// file without loading it all, and the page can't read local files directly, so this serves them.
//
// Only files registered through register() are served, each under a random id, and only on
// 127.0.0.1 - it can't be used to read anything else on the machine.
const crypto = require("node:crypto")
const fs = require("node:fs")
const http = require("node:http")

const MIME = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
	opus: "audio/ogg",
	fbx: "application/octet-stream",
	glb: "model/gltf-binary",
	gltf: "model/gltf+json",
}
const MEDIA_EXT = /\.([a-z0-9]+)$/i

/** "bytes=a-b" -> {start,end}; null = no usable range (serve it whole); "bad" = unsatisfiable. */
function parseRange(header, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "")
	if (!m || (m[1] === "" && m[2] === "")) return null
	let start
	let end
	if (m[1] === "") {
		start = Math.max(0, size - Number(m[2]))
		end = size - 1
	} else {
		start = Number(m[1])
		end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
	}
	return start > end || start >= size ? "bad" : { start, end }
}

function createMediaServer() {
	const byId = new Map() // id -> absolute path
	const byPath = new Map() // absolute path -> id
	let port = 0

	const server = http.createServer((req, res) => {
		const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Length, Content-Range" }
		const id = /^\/media\/([0-9a-f]{32})$/.exec((req.url ?? "").split("?")[0])?.[1]
		const file = id && byId.get(id)
		if (!file || (req.method !== "GET" && req.method !== "HEAD")) {
			res.writeHead(404, cors).end()
			return
		}
		let size
		try {
			size = fs.statSync(file).size
		} catch {
			res.writeHead(404, cors).end()
			return
		}
		const ext = MEDIA_EXT.exec(file)?.[1]?.toLowerCase() ?? ""
		const base = { ...cors, "Accept-Ranges": "bytes", "Content-Type": MIME[ext] ?? "application/octet-stream" }
		const range = parseRange(req.headers.range, size)
		if (range === "bad") {
			res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` }).end()
			return
		}
		const start = range ? range.start : 0
		const end = range ? range.end : size - 1
		res.writeHead(range ? 206 : 200, {
			...base,
			"Content-Length": size === 0 ? 0 : end - start + 1,
			...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
		})
		if (req.method === "HEAD" || size === 0) {
			res.end()
			return
		}
		const stream = fs.createReadStream(file, { start, end })
		stream.on("error", () => res.destroy())
		res.on("close", () => stream.destroy()) // the player seeked away or closed
		stream.pipe(res)
	})

	return {
		start() {
			return new Promise((resolve) => {
				server.listen(0, "127.0.0.1", () => {
					port = server.address().port
					resolve(port)
				})
			})
		},
		/** URL for a media file, or null if it isn't a media type or doesn't exist. */
		register(filePath) {
			if (typeof filePath !== "string") return null
			const ext = MEDIA_EXT.exec(filePath)?.[1]?.toLowerCase()
			if (!ext || !MIME[ext]) return null
			try {
				if (!fs.statSync(filePath).isFile()) return null
			} catch {
				return null
			}
			let id = byPath.get(filePath)
			if (!id) {
				id = crypto.randomBytes(16).toString("hex")
				byPath.set(filePath, id)
				byId.set(id, filePath)
			}
			return `http://127.0.0.1:${port}/media/${id}`
		},
		close() {
			server.close()
		},
	}
}

module.exports = { createMediaServer, parseRange }
