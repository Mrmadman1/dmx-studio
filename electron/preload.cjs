const { contextBridge, ipcRenderer, webUtils } = require("electron")

contextBridge.exposeInMainWorld("dmx", {
	list: () => ipcRenderer.invoke("dmx:list"),
	connect: (path) => ipcRenderer.invoke("dmx:connect", path),
	disconnect: () => ipcRenderer.invoke("dmx:disconnect"),
	sendFrame: (slots) => ipcRenderer.send("dmx:frame", slots),
	onStatus: (cb) => {
		const handler = (_e, status) => cb(status)
		ipcRenderer.on("dmx:status", handler)
		return () => ipcRenderer.removeListener("dmx:status", handler)
	},
})

contextBridge.exposeInMainWorld("studio", {
	/** absolute path of a File dropped onto the window */
	pathForFile: (file) => webUtils.getPathForFile(file),
	openAudio: () => ipcRenderer.invoke("dialog:openAudio"),
	openVideo: () => ipcRenderer.invoke("dialog:openVideo"),
	mediaUrl: (path) => ipcRenderer.invoke("media:url", path),
	loadAutosave: () => ipcRenderer.invoke("project:loadAutosave"),
	autosave: (json) => ipcRenderer.send("project:autosave", json),
	saveProject: (json) => ipcRenderer.invoke("project:saveAs", json),
	openProject: () => ipcRenderer.invoke("project:open"),
})
