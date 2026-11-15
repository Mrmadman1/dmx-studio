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
	openText: () => ipcRenderer.invoke("dialog:openText"),
	saveText: (defaultName, text) => ipcRenderer.invoke("dialog:saveText", defaultName, text),
	mediaUrl: (path) => ipcRenderer.invoke("media:url", path),
	projectionDisplays: () => ipcRenderer.invoke("projection:displays"),
	projectionOpen: (displayId) => ipcRenderer.invoke("projection:open", displayId),
	projectionClose: () => ipcRenderer.invoke("projection:close"),
	projectionSend: (json) => ipcRenderer.send("projection:state", json),
	projectionGet: () => ipcRenderer.invoke("projection:get"),
	onProjectionState: (cb) => {
		const handler = (_e, json) => cb(json)
		ipcRenderer.on("projection:state", handler)
		return () => ipcRenderer.removeListener("projection:state", handler)
	},
	onProjectionStatus: (cb) => {
		const handler = (_e, open) => cb(open)
		ipcRenderer.on("projection:status", handler)
		return () => ipcRenderer.removeListener("projection:status", handler)
	},
	demoStageUrl: () => ipcRenderer.invoke("stage:demoUrl"),
	loadAutosave: () => ipcRenderer.invoke("project:loadAutosave"),
	autosave: (json) => ipcRenderer.send("project:autosave", json),
	saveProject: (json) => ipcRenderer.invoke("project:saveAs", json),
	openProject: () => ipcRenderer.invoke("project:open"),
})
