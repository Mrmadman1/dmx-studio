import { OrbitControls, TransformControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

import { fixtureLook, fixturePose } from "../lib/look"
import { profileById } from "../lib/profiles"
import { defaultTransform, fixtureTransform } from "../lib/stage"
import { getLoadedStage } from "../lib/stageModel"
import { useStore } from "../lib/store"

export interface Stage3DProps {
	tool: "translate" | "rotate"
	snap: boolean
	/** bumped each time the user asks to frame the selection */
	frameTick: number
	/** house/work light level: 0 is a dark concert, 1 is comfortable to build in, 2 is bright */
	ambient: number
}

const RAD = Math.PI / 180
const BEAM_ANGLE = 0.42 // half-angle of the light cone, radians
const BEAM_LEN = 10
const BEAM_R = BEAM_LEN * Math.tan(BEAM_ANGLE)
const OVERVIEW_TARGET = new THREE.Vector3(0, 1.8, -1)
const OVERVIEW_POSITION = new THREE.Vector3(0, 3.4, 10)

/** The visible shaft of light: brightest at the lens, fading toward the floor and at the cone's edges. */
function makeBeamMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0 }, uLen: { value: BEAM_LEN } },
		vertexShader: /* glsl */ `
			uniform float uLen;
			varying vec3 vNormal;
			varying vec3 vViewDir;
			varying float vT;
			void main() {
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				vNormal = normalize(normalMatrix * normal);
				vViewDir = normalize(-mv.xyz);
				vT = (uLen * 0.5 - position.y) / uLen; // 0 at the lens, 1 at the far end
				gl_Position = projectionMatrix * mv;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uIntensity;
			varying vec3 vNormal;
			varying vec3 vViewDir;
			varying float vT;
			void main() {
				float along = pow(clamp(1.0 - vT, 0.0, 1.0), 1.4);
				float edge = pow(abs(dot(normalize(vNormal), normalize(vViewDir))), 1.2);
				gl_FragColor = vec4(uColor, along * edge * 0.5 * uIntensity);
			}`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
	})
}

/**
 * One light: a can, a lens that glows, a spot light that lights the set, and a visible beam. A moving
 * head also has a base that stays bolted to the truss, a yoke that turns left/right (pan), and a head
 * that nods up/down (tilt); the lens, spot and beam ride on the head, so the beam sweeps as it moves.
 */
function FixtureModel(props: {
	id: string
	index: number
	count: number
	selected: boolean
	onObject: (o: THREE.Object3D | null) => void
}): React.JSX.Element {
	const { id, index, count, selected, onObject } = props
	// pos/rot are stable references in the store, so this only re-renders when the light is actually moved
	const pos = useStore((s) => s.fixtures.find((f) => f.id === id)?.pos)
	const rot = useStore((s) => s.fixtures.find((f) => f.id === id)?.rot)
	const profileId = useStore((s) => s.fixtures.find((f) => f.id === id)?.profileId)
	const mover = !!profileId && !!profileById(profileId).motion
	// the starting slot depends on whether a stage model (with its truss positions) is loaded
	const stageStatus = useStore((s) => s.stageStatus)
	// (stageStatus is in the deps on purpose: it's the signal that the hang points changed)
	const fallback = useMemo(() => defaultTransform(index, count), [index, count, stageStatus])
	const group = useRef<THREE.Group>(null)
	const yoke = useRef<THREE.Group>(null)
	const head = useRef<THREE.Group>(null)
	const spot = useRef<THREE.SpotLight>(null)
	const lens = useRef<THREE.MeshBasicMaterial>(null)
	const beam = useMemo(makeBeamMaterial, [])

	useEffect(() => {
		// the spot aims at its target; parent the target to the light so it turns with it
		const l = spot.current
		if (!l) return
		l.add(l.target)
		l.target.position.set(0, -1, 0)
	}, [])

	useEffect(() => {
		if (!selected) return
		onObject(group.current)
		return () => onObject(null)
	}, [selected, onObject])

	// Drive the look straight from the store each frame (no React re-render at 60 Hz).
	useFrame(() => {
		const s = useStore.getState()
		const f = s.fixtures.find((x) => x.id === id)
		if (!f) return
		const look = fixtureLook(s, f)
		const r = look.r / 255
		const g = look.g / 255
		const b = look.b / 255
		if (spot.current) {
			spot.current.color.setRGB(r, g, b)
			// brightness only: never toggle .visible, that would recompile every shader
			spot.current.intensity = 90 * look.lit
		}
		lens.current?.color.setRGB(r * look.lit, g * look.lit, b * look.lit)
		beam.uniforms.uColor.value.setRGB(r, g, b)
		beam.uniforms.uIntensity.value = look.lit
		if (mover) {
			// where the motors really are (limited by their speed), not where the frames wish they were
			const pose = fixturePose(s, f)
			if (pose && yoke.current && head.current) {
				yoke.current.rotation.y = pose.pan * RAD
				head.current.rotation.x = pose.tilt * RAD
			}
		}
	})

	const select = (e: { stopPropagation: () => void }): void => {
		e.stopPropagation()
		useStore.getState().selectFixture(id)
	}
	const lamp = (
		<>
			<mesh onClick={select}>
				<cylinderGeometry args={[0.2, 0.17, 0.36, 24]} />
				<meshStandardMaterial color={selected ? "#3d6b67" : "#34343c"} metalness={0.5} roughness={0.5} />
			</mesh>
			{!mover && (
				<mesh position={[0, 0.27, 0]}>
					<boxGeometry args={[0.07, 0.18, 0.07]} />
					<meshStandardMaterial color="#26262c" metalness={0.6} roughness={0.5} />
				</mesh>
			)}
			<mesh position={[0, -0.185, 0]} rotation={[Math.PI / 2, 0, 0]}>
				<circleGeometry args={[0.155, 24]} />
				<meshBasicMaterial ref={lens} color="#000000" toneMapped={false} />
			</mesh>
			<spotLight ref={spot} position={[0, -0.2, 0]} angle={BEAM_ANGLE} penumbra={0.5} distance={26} decay={2} intensity={0} />
			<mesh position={[0, -BEAM_LEN / 2 - 0.2, 0]}>
				<coneGeometry args={[BEAM_R, BEAM_LEN, 40, 1, true]} />
				<primitive object={beam} attach="material" />
			</mesh>
		</>
	)

	return (
		<group ref={group} position={pos ?? fallback.pos} rotation={rot ?? (mover ? [0, 0, 0] : fallback.rot)}>
			{mover ? (
				<>
					{/* the base: bolted to the truss, never turns */}
					<mesh position={[0, 0.7, 0]} onClick={select}>
						<boxGeometry args={[0.36, 0.14, 0.36]} />
						<meshStandardMaterial color="#26262c" metalness={0.6} roughness={0.5} />
					</mesh>
					{/* the yoke: turns left and right (pan) and carries the head */}
					<group ref={yoke}>
						<mesh position={[0, 0.62, 0]}>
							<boxGeometry args={[0.52, 0.06, 0.12]} />
							<meshStandardMaterial color="#2c2c33" metalness={0.6} roughness={0.5} />
						</mesh>
						{[-0.25, 0.25].map((x) => (
							<mesh key={x} position={[x, 0.31, 0]}>
								<boxGeometry args={[0.05, 0.62, 0.12]} />
								<meshStandardMaterial color="#2c2c33" metalness={0.6} roughness={0.5} />
							</mesh>
						))}
						{/* the head: nods up and down (tilt) */}
						<group ref={head}>{lamp}</group>
					</group>
				</>
			) : (
				lamp
			)}
		</group>
	)
}

/** A floor to stand on: a plain dark plane with a metre grid, so there's always something to judge positions against. */
function Ground(): React.JSX.Element {
	return (
		<group>
			<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
				<planeGeometry args={[80, 80]} />
				<meshStandardMaterial color="#2b2b33" roughness={0.95} />
			</mesh>
			<gridHelper args={[40, 40, "#5a5a68", "#3a3a46"]} position={[0, 0, 0]} />
		</group>
	)
}

/** The loaded stage model, if the show has one and it has finished loading. */
function LoadedStage(): React.JSX.Element | null {
	const wanted = useStore((s) => s.stage)
	const status = useStore((s) => s.stageStatus)
	const model = wanted && status === "ready" ? getLoadedStage() : null
	return model ? <primitive object={model.object} /> : null
}

/** Moves the camera to the selected light, or back to an overview of the stage. */
function CameraFramer({ tick }: { tick: number }): null {
	const camera = useThree((s) => s.camera)
	const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
	useEffect(() => {
		if (!tick || !controls) return
		const s = useStore.getState()
		const i = s.fixtures.findIndex((f) => f.id === s.selectedId)
		if (i >= 0) {
			const { pos } = fixtureTransform(s.fixtures[i], i, s.fixtures.length)
			controls.target.set(pos[0], pos[1], pos[2])
			camera.position.set(pos[0] + 2.5, pos[1] + 1.8, pos[2] + 5)
		} else {
			const o = s.stage && s.stageStatus === "ready" ? getLoadedStage()?.overview : undefined
			controls.target.fromArray(o ? o.target : OVERVIEW_TARGET.toArray())
			camera.position.fromArray(o ? o.position : OVERVIEW_POSITION.toArray())
		}
		controls.update()
	}, [tick, camera, controls])
	return null
}

/** Everything that sits in the scene: the floor, house lights, the stage model and one model per light. */
export function StageScene(props: {
	ids: string[]
	selectedId: string | null
	onObject: (o: THREE.Object3D | null) => void
	ambient: number
}): React.JSX.Element {
	const { ids, selectedId, onObject, ambient } = props
	return (
		<>
			<color attach="background" args={["#15151b"]} />
			{/* house lights. Light intensities are physical now, so a surface needs roughly pi to read at full colour. */}
			<hemisphereLight color="#aebbd8" groundColor="#3a3a46" intensity={0.5 * Math.PI * ambient} />
			<ambientLight intensity={0.2 * Math.PI * ambient} />
			<Ground />
			<LoadedStage />
			{ids.map((id, i) => (
				<FixtureModel key={id} id={id} index={i} count={ids.length} selected={id === selectedId} onObject={onObject} />
			))}
		</>
	)
}

export default function Stage3D({ tool, snap, frameTick, ambient }: Stage3DProps): React.JSX.Element {
	const idKey = useStore((s) => s.fixtures.map((f) => f.id).join("|"))
	const ids = idKey ? idKey.split("|") : []
	const selectedId = useStore((s) => s.selectedId)
	const stageStatus = useStore((s) => s.stageStatus)
	const [target, setTarget] = useState<THREE.Object3D | null>(null)

	// when a stage finishes loading, fly the camera out to see all of it
	const [autoTick, setAutoTick] = useState(0)
	useEffect(() => {
		if (stageStatus === "ready") setAutoTick((t) => t + 1)
	}, [stageStatus])

	/** Write the gizmo's result back into the show when a drag ends. */
	const commit = (): void => {
		if (!target || !selectedId) return
		const r = target.rotation
		useStore.getState().setFixtureTransform(selectedId, [target.position.x, target.position.y, target.position.z], [r.x, r.y, r.z])
	}

	return (
		<div className="absolute inset-0">
			<Canvas
				camera={{ position: OVERVIEW_POSITION.toArray(), fov: 50, near: 0.1, far: 200 }}
				dpr={[1, 2]}
				onPointerMissed={(e) => {
					if (e.type === "click") useStore.getState().selectFixture(null)
				}}
			>
				<StageScene ids={ids} selectedId={selectedId} onObject={setTarget} ambient={ambient} />
				<OrbitControls
					makeDefault
					target={OVERVIEW_TARGET.toArray()}
					mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
					maxPolarAngle={Math.PI * 0.92}
					minDistance={0.5}
					maxDistance={80}
				/>
				{target && selectedId && (
					<TransformControls
						object={target}
						mode={tool}
						translationSnap={snap ? 0.25 : null}
						rotationSnap={snap ? Math.PI / 12 : null}
						onMouseUp={commit}
					/>
				)}
				<CameraFramer tick={frameTick + autoTick} />
			</Canvas>
		</div>
	)
}
