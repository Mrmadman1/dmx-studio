import * as THREE from "three"
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

import { type Vec3, setHangPoints } from "./stage"
import { useStore } from "./store"

export interface LoadedStage {
	object: THREE.Group
	/** where the model's own lights hung, centre-out and front-first: where new lights should start */
	hangPoints: Vec3[]
	/** a camera pose that shows the whole stage */
	overview: { target: Vec3; position: Vec3 }
	stats: { triangles: number; removedFixtures: number; meshes: number }
}

/** Vectorworks names each hung light "Lighting_Device…", with every part of the fixture nested inside. */
const FIXTURE_GROUP = /^Lighting_Device/i

/** How to colour each kind of object. The file has one flat material, so we tell parts apart by name. */
const LOOKS = {
	speaker: { color: "#1b1b20", metalness: 0.1, roughness: 0.85 },
	deck: { color: "#7a7a86", metalness: 0.05, roughness: 0.8 },
	truss: { color: "#b4bac6", metalness: 0.65, roughness: 0.45 },
	set: { color: "#9a9aa8", metalness: 0.05, roughness: 0.85 },
} as const
type Category = keyof typeof LOOKS

const categoryOf = (mesh: THREE.Object3D): Category => {
	let path = ""
	for (let o: THREE.Object3D | null = mesh; o; o = o.parent) path += `/${o.name}`
	if (/Speaker/i.test(path)) return "speaker"
	if (/Stage_(Deck|Steps)/i.test(path)) return "deck"
	if (/Truss/i.test(path)) return "truss"
	return "set"
}

/** After a mirrored transform a triangle's winding is reversed and would be culled as a back face; swap two corners back. */
function flipWinding(g: THREE.BufferGeometry): void {
	for (const name of ["position", "normal"]) {
		const a = g.getAttribute(name).array as Float32Array
		for (let t = 0; t + 8 < a.length; t += 9) {
			for (let k = 0; k < 3; k++) {
				const tmp = a[t + 3 + k]
				a[t + 3 + k] = a[t + 6 + k]
				a[t + 6 + k] = tmp
			}
		}
	}
}

/**
 * Turn a freshly parsed FBX into something the 3D view can use:
 *  - drop its built-in lights and cameras (they would add real lights to our scene)
 *  - drop the light fixtures hung on the trusses, remembering where each one was
 *  - convert millimetres to metres, stand it on the floor and centre it
 *  - merge thousands of small meshes into a handful, so it draws fast
 */
export function processStage(root: THREE.Object3D): LoadedStage {
	root.updateMatrixWorld(true)

	// where the lights hung: the file's own spot lights, or failing that the fixture models' centres
	const spots: THREE.Vector3[] = []
	root.traverse((o) => {
		if ((o as THREE.SpotLight).isSpotLight) spots.push(o.getWorldPosition(new THREE.Vector3()))
	})
	const doomed: THREE.Object3D[] = []
	const collect = (o: THREE.Object3D): void => {
		for (const child of o.children) {
			const light = (child as THREE.Light).isLight
			const camera = (child as THREE.Camera).isCamera
			if (light || camera || FIXTURE_GROUP.test(child.name)) doomed.push(child)
			else collect(child)
		}
	}
	collect(root)
	const centres: THREE.Vector3[] = []
	let removedFixtures = 0
	for (const o of doomed) {
		if (!FIXTURE_GROUP.test(o.name)) continue
		removedFixtures++
		centres.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()))
	}
	for (const o of doomed) o.parent?.remove(o)
	root.updateMatrixWorld(true)

	// units: Vectorworks exports millimetres. Anything bigger than 200 "units" across can't be metres.
	const box = new THREE.Box3().setFromObject(root)
	const size = box.getSize(new THREE.Vector3())
	const centre = box.getCenter(new THREE.Vector3())
	const unit = Math.max(size.x, size.y, size.z) > 200 ? 0.001 : 1
	const toStage = new THREE.Matrix4()
		.makeScale(unit, unit, unit)
		.multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z))

	const buckets: Record<Category, THREE.BufferGeometry[]> = { speaker: [], deck: [], truss: [], set: [] }
	let meshes = 0
	root.traverse((o) => {
		const mesh = o as THREE.Mesh
		if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return
		meshes++
		// merging needs every geometry shaped the same: unindexed, position + normal only
		const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
		for (const name of Object.keys(g.attributes)) {
			if (name !== "position" && name !== "normal") g.deleteAttribute(name)
		}
		g.morphAttributes = {}
		g.clearGroups()
		if (!g.getAttribute("normal")) g.computeVertexNormals()
		const m = new THREE.Matrix4().multiplyMatrices(toStage, mesh.matrixWorld)
		g.applyMatrix4(m)
		if (m.determinant() < 0) flipWinding(g)
		buckets[categoryOf(mesh)].push(g)
		mesh.geometry.dispose()
	})

	const object = new THREE.Group()
	object.name = "stage"
	let triangles = 0
	for (const key of Object.keys(buckets) as Category[]) {
		if (!buckets[key].length) continue
		const merged = mergeGeometries(buckets[key], false)
		for (const g of buckets[key]) g.dispose()
		if (!merged) continue
		triangles += merged.getAttribute("position").count / 3
		merged.computeBoundingSphere()
		object.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial(LOOKS[key])))
	}

	// hang points: front truss first, then working outwards from the middle of each, so a few lights spread evenly
	const points = (spots.length ? spots : centres).map((p) => p.clone().applyMatrix4(toStage))
	points.sort((a, b) => Math.round(b.z * 2) - Math.round(a.z * 2) || Math.abs(a.x) - Math.abs(b.x))
	const hangPoints = points.map((p): Vec3 => [round(p.x), round(p.y), round(p.z)])

	const s = size.clone().multiplyScalar(unit)
	const longest = Math.max(s.x, s.y, s.z)
	return {
		object,
		hangPoints,
		overview: { target: [0, round(s.y * 0.35), 0], position: [0, round(s.y * 0.6), round(s.z / 2 + longest * 0.9)] },
		stats: { triangles: Math.round(triangles), removedFixtures, meshes },
	}
}

const round = (n: number): number => Math.round(n * 1000) / 1000

let current: LoadedStage | null = null
let loading: Promise<void> | null = null

export const getLoadedStage = (): LoadedStage | null => current

/** Free the loaded model and forget its hang points. */
export function unloadStage(): void {
	if (current) {
		current.object.traverse((o) => {
			const m = o as THREE.Mesh
			if (m.isMesh) {
				m.geometry.dispose()
				;(m.material as THREE.Material).dispose()
			}
		})
	}
	current = null
	setHangPoints([])
}

/** Load the demo stage that ships with the app. Safe to call twice: the second call waits for the first. */
export function loadDemoStage(): Promise<void> {
	if (current) return Promise.resolve()
	if (loading) return loading
	const store = useStore.getState()
	store.setStage("demo")
	store.setStageStatus("loading")
	loading = (async () => {
		try {
			const url = await window.studio?.demoStageUrl()
			if (!url) throw new Error("The demo stage file is missing from the app folder.")
			const res = await fetch(url)
			if (!res.ok) throw new Error(`Couldn't read the demo stage (${res.status}).`)
			const bytes = await res.arrayBuffer()
			await new Promise((r) => setTimeout(r, 30)) // let the "Loading…" label paint; parsing blocks for a second or two
			current = processStage(new FBXLoader().parse(bytes, ""))
			setHangPoints(current.hangPoints)
			useStore.getState().setStageStatus("ready")
		} catch (e) {
			useStore.getState().setStageStatus("error", e instanceof Error ? e.message : String(e))
		} finally {
			loading = null
		}
	})()
	return loading
}

/** Take the stage out of the scene (and out of the show). */
export function removeStage(): void {
	unloadStage()
	const s = useStore.getState()
	s.setStage(null)
	s.setStageStatus("idle")
}
