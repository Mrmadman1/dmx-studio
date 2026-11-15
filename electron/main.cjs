const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs/promises")
const { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker } = require("electron")
const { DmxEngine } = require("./dmx.cjs")
const { createMediaServer } = require("./media-server.cjs")

// A light show has to keep running when the window is behind another app or minimised.
// Chromium and Windows both throttle timers and lower the priority of background windows,
// which stretched the DMX frame gaps and made the light flicker.
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-background-timer-throttling")
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion")

let win = null
let dmx = null // created once the app is ready (it forks a utility process)

function createWindow() {
	win = new BrowserWindow({
		width: 1500,
		height: 900,
		backgroundColor: "#141416",
		title: "DMX Studio",
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			// the audio clock drives the show, so it must run without waiting for a click
			autoplayPolicy: "no-user-gesture-required",
		},
	})
	if (app.isPackaged || process.env.DMX_STUDIO_PROD) {
		void win.loadFile(path.join(__dirname, "..", "dist", "index.html"))
	} else {
		void win.loadURL("http://localhost:5173")
	}
}

ipcMain.handle("dmx:list", () => dmx.list())
ipcMain.handle("dmx:connect", async (_e, p) => {
	try {
		await dmx.connect(p)
		return { ok: true }
	} catch (err) {
		return { ok: false, error: String(err.message ?? err) }
	}
})
ipcMain.handle("dmx:disconnect", () => dmx.disconnect())
ipcMain.on("dmx:frame", (_e, slots) => dmx.setFrame(slots))

// --- files and projects -------------------------------------------------------------
const media = createMediaServer()
const SHOW_FILTER = [{ name: "DMX Studio show", extensions: ["dmxshow"] }]
const autosavePath = () => path.join(app.getPath("userData"), "autosave.dmxshow")

ipcMain.handle("dialog:openAudio", async () => {
	const r = await dialog.showOpenDialog(win, {
		properties: ["openFile", "multiSelections"],
		filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] }],
	})
	return r.canceled ? [] : r.filePaths
})

ipcMain.handle("dialog:openVideo", async () => {
	const r = await dialog.showOpenDialog(win, {
		properties: ["openFile"],
		filters: [{ name: "Video", extensions: ["mp4", "m4v", "mov", "webm", "mkv"] }],
	})
	return r.canceled ? null : (r.filePaths[0] ?? null)
})

// The 3D demo stage that ships with the app (a Vectorworks export, in millimetres).
const DEMO_STAGE = path.join(__dirname, "..", "assets", "stages", "slaitinis-stogas.fbx")
ipcMain.handle("stage:demoUrl", () => media.register(DEMO_STAGE))

// A localhost URL the page can stream a picked media file from (null if it's missing or not media).
ipcMain.handle("media:url", (_e, p) => media.register(p))

ipcMain.handle("project:loadAutosave", async () => {
	try {
		return await fs.readFile(autosavePath(), "utf8")
	} catch {
		return null
	}
})
ipcMain.on("project:autosave", async (_e, json) => {
	try {
		await fs.writeFile(autosavePath(), String(json))
	} catch {
		// a failed autosave shouldn't interrupt the show
	}
})
ipcMain.handle("project:saveAs", async (_e, json) => {
	const r = await dialog.showSaveDialog(win, { defaultPath: "my-show.dmxshow", filters: SHOW_FILTER })
	if (r.canceled || !r.filePath) return null
	await fs.writeFile(r.filePath, String(json))
	return r.filePath
})
ipcMain.handle("project:open", async () => {
	const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: SHOW_FILTER })
	if (r.canceled || !r.filePaths[0]) return null
	return fs.readFile(r.filePaths[0], "utf8")
})

app.whenReady().then(async () => {
	await media.start()
	powerSaveBlocker.start("prevent-app-suspension")
	try {
		os.setPriority(0, os.constants.priority.PRIORITY_HIGH)
	} catch {
		// not allowed on this machine: carry on at normal priority
	}
	dmx = new DmxEngine((status) => {
		if (win && !win.isDestroyed()) win.webContents.send("dmx:status", status)
	})
	createWindow()
})
app.on("window-all-closed", async () => {
	try {
		await dmx?.disconnect()
	} catch {
		// the DMX process is already gone
	}
	dmx?.dispose()
	media.close()
	app.quit()
})
