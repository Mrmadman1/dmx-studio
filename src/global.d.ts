export interface DmxPortInfo {
	path: string
	manufacturer: string
	vendorId: string
	productId: string
}

export type DmxStatus =
	| { state: "disconnected" }
	| { state: "connected"; path: string; fps?: number; worstMs?: number }
	| { state: "error"; message: string }

export interface DmxApi {
	list: () => Promise<DmxPortInfo[]>
	connect: (path: string) => Promise<{ ok: boolean; error?: string }>
	disconnect: () => Promise<void>
	sendFrame: (slots: Uint8Array) => void
	onStatus: (cb: (s: DmxStatus) => void) => () => void
}

export interface StudioApi {
	pathForFile: (file: File) => string
	openAudio: () => Promise<string[]>
	openVideo: () => Promise<string | null>
	/** pick a text file (an effect pack): its text, an error, or null if cancelled */
	openText: () => Promise<{ text: string } | { error: string } | null>
	/** ask where to save a text file; returns the path, or null if cancelled */
	saveText: (defaultName: string, text: string) => Promise<string | null>
	/** a localhost URL to stream a picked audio/video file from, or null if it's missing */
	mediaUrl: (path: string) => Promise<string | null>
	/** a localhost URL for the demo stage model that ships with the app */
	demoStageUrl: () => Promise<string | null>
	loadAutosave: () => Promise<string | null>
	autosave: (json: string) => void
	saveProject: (json: string) => Promise<string | null>
	openProject: () => Promise<string | null>
}

declare global {
	interface Window {
		dmx?: DmxApi
		studio?: StudioApi
	}
}
