export interface BeatResult {
	bpm: number
	/** beat times in seconds from the start of the audio */
	beats: number[]
}

interface AudioLike {
	sampleRate: number
	length: number
	numberOfChannels: number
	getChannelData(channel: number): Float32Array
}

const HOP = 512

/**
 * Find a steady tempo and where its beats fall. Assumes one constant tempo (fine for most dance
 * and pop tracks; a song that changes speed will drift). Returns null when nothing steady is found.
 *
 * 1. Cut the song into 512-sample hops and measure how much louder each hop is than the ones
 *    just before it, in a bass band (kicks) and a treble band (snares, hats). That "onset
 *    strength" curve spikes on every hit.
 * 2. Autocorrelate it: a steady beat repeats, so the lag where it best matches itself is the tempo.
 * 3. Slide a comb of evenly spaced beats over the curve, tuning period and phase together, and
 *    keep the position where the comb lands on the most onset energy.
 */
export function detectBeats(audio: AudioLike): BeatResult | null {
	const sr = audio.sampleRate
	const frames = Math.floor(audio.length / HOP)
	if (frames < 200) return null // shorter than ~2.5 s
	const hopSec = HOP / sr

	const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
	const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sr)
	const aHigh = 1 - Math.exp((-2 * Math.PI * 1500) / sr)
	let yLow = 0
	let yMid = 0
	const lowRms = new Float32Array(frames)
	const highRms = new Float32Array(frames)
	for (let f = 0; f < frames; f++) {
		let eLow = 0
		let eHigh = 0
		const end = (f + 1) * HOP
		for (let i = f * HOP; i < end; i++) {
			let x = 0
			for (const ch of channels) x += ch[i]
			x /= channels.length
			yLow += aLow * (x - yLow)
			yMid += aHigh * (x - yMid)
			const hi = x - yMid // everything above ~1.5 kHz
			eLow += yLow * yLow
			eHigh += hi * hi
		}
		lowRms[f] = Math.sqrt(eLow / HOP)
		highRms[f] = Math.sqrt(eHigh / HOP)
	}

	const onsetOf = (env: Float32Array): Float32Array => {
		const out = new Float32Array(frames)
		let max = 0
		for (let n = 4; n < frames; n++) {
			const prev = (env[n - 1] + env[n - 2] + env[n - 3] + env[n - 4]) / 4
			out[n] = Math.max(0, env[n] - prev)
			if (out[n] > max) max = out[n]
		}
		if (max > 0) for (let n = 0; n < frames; n++) out[n] /= max
		return out
	}
	const lowOn = onsetOf(lowRms)
	const highOn = onsetOf(highRms)
	const onset = new Float32Array(frames)
	for (let n = 0; n < frames; n++) onset[n] = lowOn[n] + 0.5 * highOn[n]

	// --- tempo: autocorrelation over 70-185 BPM, nudged toward typical tempos ---
	const minLag = Math.max(2, Math.floor(60 / (185 * hopSec)))
	const maxLag = Math.ceil(60 / (70 * hopSec))
	const score = new Float64Array(maxLag + 2)
	let bestLag = 0
	let bestScore = 0
	for (let lag = minLag; lag <= maxLag; lag++) {
		let s = 0
		for (let n = 0; n + lag < frames; n++) s += onset[n] * onset[n + lag]
		s /= frames - lag
		const bpm = 60 / (lag * hopSec)
		score[lag] = s * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2)
		if (score[lag] > bestScore) {
			bestScore = score[lag]
			bestLag = lag
		}
	}
	if (bestLag === 0 || bestScore <= 0) return null

	// parabolic interpolation for a sub-hop tempo estimate
	let period = bestLag
	if (bestLag > minLag && bestLag < maxLag) {
		const s1 = score[bestLag - 1]
		const s2 = score[bestLag]
		const s3 = score[bestLag + 1]
		const denom = s1 - 2 * s2 + s3
		if (denom !== 0) period = bestLag + (0.5 * (s1 - s3)) / denom
	}

	// --- period + phase: slide a comb of beats over the onset curve ---
	const at = (x: number): number => {
		const i = Math.floor(x)
		if (i < 0 || i + 1 >= frames) return 0
		const f = x - i
		return onset[i] * (1 - f) + onset[i + 1] * f
	}
	let bestP = period
	let bestPhase = 0
	let bestComb = -1
	for (let p = period - 0.8; p <= period + 0.8; p += 0.02) {
		for (let phase = 0; phase < p; phase += 0.25) {
			let sum = 0
			for (let x = phase; x < frames - 1; x += p) sum += at(x)
			if (sum > bestComb) {
				bestComb = sum
				bestP = p
				bestPhase = phase
			}
		}
	}

	const beats: number[] = []
	for (let x = bestPhase; x < frames - 1; x += bestP) beats.push(Math.round((x + 0.5) * hopSec * 1000) / 1000)
	return { bpm: Math.round((60 / (bestP * hopSec)) * 10) / 10, beats }
}
