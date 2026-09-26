import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PLAYER_Z, ZONES, ZONE_LENGTH, roadCurve, roadHill, zoneAt, type Race, type Traffic } from './race'

type Part = { geometry: THREE.BufferGeometry; color: THREE.ColorRepresentation }
type Particle = { life: number; maxLife: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; color: THREE.Color }
type TrafficView = { object: THREE.Group; brake: THREE.Object3D; left: THREE.Object3D; right: THREE.Object3D; lastX: number }
export type BurstKind = 'spark' | 'crash' | 'dust' | 'oil' | 'pad'
const coral = 0xff6749
const mint = 0x83ffe4
const amber = 0xffa53a
const palette = [0xf1c75b, 0x48b5bb, 0xb1a0d4, 0xe7ddd0, 0xc76e65, 0x518fa5]
const burstColors: Record<BurstKind, number> = { spark: mint, crash: 0xffb06a, dust: 0xc9a48a, oil: 0x6a4a8f, pad: 0xa8fff0 }
const box = new THREE.BoxGeometry(1, 1, 1)
const dummy = new THREE.Object3D()
const tmp = new THREE.Color()
const SLOT_SPAN = 504

/** Shared "curved world" uniform: x bends the road left/right, y raises or drops the horizon. */
const bend = { value: new THREE.Vector2() }
function curved<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    shader.uniforms.uBend = bend
    shader.vertexShader = 'uniform vec2 uBend;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      float bendDepth = min(mvPosition.z, 0.0);
      mvPosition.xy += uBend * bendDepth * bendDepth;
      gl_Position = projectionMatrix * mvPosition;`)
  }
  return material
}

// Per-district look. Sky colours are raw display values; others go through colour management.
interface Look {
  horizon: number; top: number; sun: number; fog: number; fogNear: number; fogFar: number; ground: number
  mountains: [number, number, number]; hemi: number; key: number; night: number; wet: number
  water: [number, number]; waterEdge: [number, number]
}
const LOOKS: Look[] = [
  { horizon: 0xe05c45, top: 0x130c29, sun: 1, fog: 0x70445b, fogNear: 115, fogFar: 360, ground: 0x2d243e,
    mountains: [0x6d4059, 0x55334c, 0x3c2b44], hemi: 3, key: 3, night: 0.15, wet: 0, water: [1, 0], waterEdge: [70, 70] },
  { horizon: 0x8a3c94, top: 0x06040f, sun: 0.35, fog: 0x3a2350, fogNear: 90, fogFar: 330, ground: 0x19151f,
    mountains: [0x3a2a55, 0x2c2145, 0x201a38], hemi: 2, key: 1.1, night: 0.85, wet: 0, water: [0, 0], waterEdge: [70, 70] },
  { horizon: 0xf2913f, top: 0x3d1734, sun: 1, fog: 0x9a5540, fogNear: 125, fogFar: 420, ground: 0x5a2c22,
    mountains: [0xa2472f, 0x7e3526, 0x5c281f], hemi: 3.3, key: 3.8, night: 0, wet: 0, water: [0, 0], waterEdge: [70, 70] },
  { horizon: 0x3a4b60, top: 0x080c14, sun: 0.05, fog: 0x28323e, fogNear: 55, fogFar: 250, ground: 0x121c24,
    mountains: [0x2a3645, 0x223040, 0x1a2533], hemi: 1.5, key: 0.6, night: 1, wet: 1, water: [1, 1], waterEdge: [15, 15] },
]

function part(parts: Part[], color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0, segments = 0) {
  // Long pieces need depth segments so the curved-world shader can bend them.
  const geometry = segments ? new THREE.BoxGeometry(1, 1, 1, 1, 1, segments) : box.clone()
  geometry.scale(w, h, d)
  geometry.rotateZ(rotation)
  geometry.translate(x, y, z)
  parts.push({ geometry, color })
}

function bake(parts: Part[], luminous = false) {
  for (const p of parts) {
    const color = new THREE.Color(p.color)
    const array = new Float32Array(p.geometry.getAttribute('position').count * 3)
    for (let i = 0; i < array.length; i += 3) { array[i] = color.r; array[i + 1] = color.g; array[i + 2] = color.b }
    p.geometry.setAttribute('color', new THREE.BufferAttribute(array, 3))
  }
  const geometry = mergeGeometries(parts.map(p => p.geometry))!
  parts.forEach(p => p.geometry.dispose())
  return new THREE.Mesh(geometry, curved(luminous
    ? new THREE.MeshBasicMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.12 })))
}

function glow(color: number, w: number, h: number, d: number, x: number, y: number, z: number, name: string) {
  const mesh = new THREE.Mesh(box, curved(new THREE.MeshBasicMaterial({ color })))
  mesh.scale.set(w, h, d)
  mesh.position.set(x, y, z)
  mesh.name = name
  mesh.visible = false
  return mesh
}

function buildCar(color: number, truck = false) {
  const group = new THREE.Group()
  const body: Part[] = []
  const lights: Part[] = []
  const length = truck ? 5.9 : 4.4
  part(body, 0x14121e, 0, 0.43, 0, 2.18, 0.35, length)
  part(body, color, 0, 0.76, 0, 2.2, 0.53, length)
  part(body, color, 0, 0.99, -1.32, 2.13, 0.16, 1.64)
  if (truck) {
    part(body, 0x9daba6, 0, 1.64, 0.55, 2.24, 1.7, 3.75)
    part(body, 0x172b3f, 0, 1.43, -1.85, 1.9, 0.63, 1.7)
    part(body, color, 0, 1.8, -1.85, 2.08, 0.15, 1.8)
    for (const x of [-0.8, 0.8]) part(body, 0x778580, x, 1.65, 2.47, 0.06, 1.58, 0.02)
  } else {
    const cabin = new THREE.BoxGeometry(1, 1, 1)
    const vertices = cabin.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) {
      const top = vertices.getY(i) > 0
      vertices.setXYZ(i, vertices.getX(i) * (top ? 1.5 : 1.96), vertices.getY(i) * 0.67 + 1.28, vertices.getZ(i) * (top ? 1.1 : 2.15) - 0.03)
    }
    cabin.computeVertexNormals()
    body.push({ geometry: cabin, color: 0x203341 })
    part(body, color, 0, 1.63, -0.03, 1.58, 0.1, 1.17)
    part(body, 0xffe9c5, -0.39, 1.08, -1.52, 0.16, 0.012, 1.15)
    part(body, 0xffe9c5, 0.39, 1.08, -1.52, 0.16, 0.012, 1.15)
    for (let i = 0; i < 5; i++) part(body, 0x1e2430, 0, 1.047, 1.13 + i * 0.14, 1.52, 0.026, 0.062)
    for (const x of [-0.82, 0.82]) part(body, 0x151921, x, 1.19, 1.83, 0.1, 0.28, 0.12)
    part(body, color, 0, 1.38, 1.83, 2.45, 0.12, 0.46)
    part(body, 0xeee1c7, 0, 0.61, 2.214, 0.45, 0.15, 0.024)
  }
  for (const x of [-1.09, 1.09]) {
    for (const z of [-length * 0.31, length * 0.31]) {
      const wheel = new THREE.CylinderGeometry(0.47, 0.47, 0.29, 12)
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(x, 0.48, z)
      body.push({ geometry: wheel, color: 0x11121a })
      const hub = new THREE.CylinderGeometry(0.25, 0.25, 0.305, 8)
      hub.rotateZ(Math.PI / 2)
      hub.translate(x, 0.48, z)
      body.push({ geometry: hub, color: 0x89989c })
    }
    part(body, color, x * 1.12, 1.12, -0.55, 0.25, 0.17, 0.32)
    part(lights, 0xffe3b0, x * 0.67, 0.86, -length / 2 - 0.013, 0.53, 0.17, 0.035)
    part(lights, 0x9a1f2e, x * 0.67, 0.85, length / 2 + 0.013, 0.63, 0.14, 0.035)
  }
  group.add(bake(body), bake(lights, true))
  const brake = new THREE.Group()
  brake.name = 'brake'
  brake.visible = false
  for (const x of [-0.67, 0.67]) {
    const lamp = glow(0xff2240, 0.72, 0.22, 0.05, x, 0.85, length / 2 + 0.04, 'lamp')
    lamp.visible = true
    brake.add(lamp)
  }
  const high = glow(0xff2240, 0.9, 0.08, 0.05, 0, truck ? 2.5 : 1.55, truck ? length / 2 + 0.04 : 1.95, 'lamp')
  high.visible = true
  brake.add(high)
  group.add(brake)
  for (const [name, side] of [['blinkL', -1], ['blinkR', 1]] as const) {
    const blinker = new THREE.Group()
    blinker.name = name
    blinker.visible = false
    for (const z of [-length / 2 - 0.03, length / 2 + 0.03]) {
      const lamp = glow(amber, 0.3, 0.16, 0.06, side * 0.98, 0.84, z, 'lamp')
      lamp.visible = true
      blinker.add(lamp)
    }
    group.add(blinker)
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.15, length + 0.55), curved(new THREE.MeshBasicMaterial({ color: 0x080814, transparent: true, opacity: 0.4, depthWrite: false })))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.024
  shadow.name = 'shadow'
  group.add(shadow)
  return group
}

function seeded(seed: number) {
  return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class HighwayWorld {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1300)
  private player = buildCar(coral)
  private playerBrake = this.player.getObjectByName('brake')!
  private playerShadow = this.player.getObjectByName('shadow')!
  private traffic = new Map<number, TrafficView>()
  private trafficTemplates = palette.map(color => [buildCar(color), buildCar(color, true)])
  private pickups = new Map<number, THREE.Group>()
  private pickupTemplates: THREE.Group[] = []
  private hazards = new Map<number, THREE.Object3D>()
  private hazardTemplates: Record<'ramp' | 'pad' | 'oil', THREE.Group>
  private padTexture: THREE.CanvasTexture
  private roadDashes: THREE.InstancedMesh
  private roadStuds: THREE.InstancedMesh
  private roadMaterial!: THREE.MeshStandardMaterial
  private nearSlots: THREE.Group[] = []
  private farSlots: THREE.Group[] = []
  private propTemplates: { near: THREE.Group[][]; far: THREE.Group[][]; ocean: THREE.Group[] } = { near: [], far: [], ocean: [] }
  private propRandom = seeded(4242)
  private gate = new THREE.Group()
  private gateSign!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private gateTarget = -1
  private particleMesh: THREE.InstancedMesh
  private particles: Particle[] = []
  private flames = new THREE.Group()
  private underglow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private headlights: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private skyGroup = new THREE.Group()
  private sky = { horizon: new THREE.Color(), top: new THREE.Color(), alpha: { value: 1 } }
  private floorMaterial!: THREE.MeshBasicMaterial
  private mountainMaterials: THREE.MeshBasicMaterial[] = []
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[] = []
  private grid!: THREE.LineSegments
  private hemi: THREE.HemisphereLight
  private key: THREE.DirectionalLight
  private stars!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private rainDrops: Float32Array
  private streaks: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  private streakData: { x: number; y: number; z: number }[] = []
  private look = { night: 0.15, wet: 0, hemi: 3, key: 3, fogNear: 115, fogFar: 360, water: [1, 0], waterEdge: [70, 70] }
  private flash = 0
  private curveView = 0
  private hillView = 0
  private menuDistance = 900
  private motion = 0
  private elapsed = 0
  private shake = 0
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  private resizeObserver: ResizeObserver
  private frameCount = 0
  private performanceTime = 0

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65))
    this.renderer.setClearColor(0x211126)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    this.renderer.domElement.setAttribute('aria-label', '3D highway racing through four districts. Dodge traffic using A and D or the arrow keys. Shift boosts, Space drifts, and P pauses.')
    this.renderer.domElement.setAttribute('role', 'img')
    container.append(this.renderer.domElement)
    this.scene.fog = new THREE.Fog(0x70445b, 115, 360)
    this.hemi = new THREE.HemisphereLight(0xf7bdb0, 0x67608b, 3)
    this.scene.add(this.hemi)
    this.key = new THREE.DirectionalLight(0xffc6a3, 3)
    this.key.position.set(-20, 45, -75)
    this.scene.add(this.key)
    const rim = new THREE.DirectionalLight(0x66e4e2, 1.6)
    rim.position.set(10, 15, 12)
    this.scene.add(rim)
    this.buildSky()
    this.buildLandscape()
    this.buildRoad()
    this.roadDashes = new THREE.InstancedMesh(box, curved(new THREE.MeshBasicMaterial({ color: 0xb5bbbf })), 132)
    this.roadDashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.roadDashes.frustumCulled = false
    this.scene.add(this.roadDashes)
    this.roadStuds = new THREE.InstancedMesh(box, curved(new THREE.MeshBasicMaterial({ color: 0xff956c })), 88)
    this.roadStuds.frustumCulled = false
    this.scene.add(this.roadStuds)
    this.buildProps()
    this.buildGate()
    this.player.position.set(0, 0.05, PLAYER_Z)
    this.scene.add(this.player)
    this.underglow = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 4.6), curved(new THREE.MeshBasicMaterial({ color: mint, transparent: true, opacity: 0.19, depthWrite: false, blending: THREE.AdditiveBlending })))
    this.underglow.rotation.x = -Math.PI / 2
    this.underglow.position.set(0, 0.03, 0)
    this.player.add(this.underglow)
    const beam = canvasTexture(64, 256, context => {
      const gradient = context.createLinearGradient(0, 256, 0, 0)
      gradient.addColorStop(0, 'rgba(255,236,200,0.9)'); gradient.addColorStop(1, 'rgba(255,236,200,0)')
      context.fillStyle = gradient
      context.beginPath(); context.moveTo(22, 256); context.lineTo(42, 256); context.lineTo(64, 0); context.lineTo(0, 0); context.fill()
    })
    this.headlights = new THREE.Mesh(new THREE.PlaneGeometry(9, 34), curved(new THREE.MeshBasicMaterial({ map: beam, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })))
    this.headlights.rotation.x = -Math.PI / 2
    this.headlights.position.set(0, 0.05, -19)
    this.player.add(this.headlights)
    for (const x of [-0.67, 0.67]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.1, 8), curved(new THREE.MeshBasicMaterial({ color: mint, transparent: true, opacity: 0.9 })))
      flame.rotation.x = Math.PI / 2
      flame.position.set(x, 0.45, 3.05)
      this.flames.add(flame)
    }
    this.player.add(this.flames)
    this.particleMesh = new THREE.InstancedMesh(box, curved(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 })), 200)
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particleMesh.frustumCulled = false
    this.particleMesh.count = 0
    this.scene.add(this.particleMesh)
    this.makePickupTemplates()
    this.padTexture = canvasTexture(128, 256, context => {
      context.fillStyle = '#0b2d2c'; context.fillRect(0, 0, 128, 256)
      context.strokeStyle = '#83ffe4'; context.lineWidth = 14; context.lineJoin = 'miter'
      for (let y = 30; y < 256; y += 64) { context.beginPath(); context.moveTo(18, y + 34); context.lineTo(64, y); context.lineTo(110, y + 34); context.stroke() }
    })
    this.padTexture.wrapT = THREE.RepeatWrapping
    this.hazardTemplates = this.makeHazardTemplates()
    const drops = 700
    this.rainDrops = new Float32Array(drops * 6)
    const random = seeded(77)
    for (let i = 0; i < drops; i++) this.placeDrop(i, (random() - 0.5) * 80, random() * 32, -90 + random() * 110)
    const rainGeometry = new THREE.BufferGeometry()
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainDrops, 3).setUsage(THREE.DynamicDrawUsage))
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa9c1d6, transparent: true, opacity: 0, fog: false }))
    this.rain.frustumCulled = false
    this.scene.add(this.rain)
    this.streaks = new THREE.InstancedMesh(box, curved(new THREE.MeshBasicMaterial({ color: 0xdffef7, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })), 48)
    this.streaks.frustumCulled = false
    for (let i = 0; i < 48; i++) {
      const side = i % 2 ? 1 : -1
      this.streakData.push({ x: side * (3 + random() * 11), y: 0.4 + random() * 6, z: -70 + random() * 80 })
    }
    this.scene.add(this.streaks)
    this.resizeObserver = new ResizeObserver(() => this.resize(container))
    this.resizeObserver.observe(container)
    this.resize(container)
  }

  private placeDrop(i: number, x: number, y: number, z: number) {
    const d = this.rainDrops
    d[i * 6] = x; d[i * 6 + 1] = y; d[i * 6 + 2] = z
    d[i * 6 + 3] = x + 0.05; d[i * 6 + 4] = y + 1.1; d[i * 6 + 5] = z - 0.5
  }

  private resize(container: HTMLElement) {
    const width = container.clientWidth, height = container.clientHeight
    this.renderer.setSize(width, height)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  private buildSky() {
    this.sky.horizon.setHex(LOOKS[0].horizon, THREE.LinearSRGBColorSpace)
    this.sky.top.setHex(LOOKS[0].top, THREE.LinearSRGBColorSpace)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uHorizon: { value: this.sky.horizon }, uTop: { value: this.sky.top } },
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform vec3 uHorizon; uniform vec3 uTop; varying vec3 vPosition;
        void main(){ float h=normalize(vPosition).y;
          vec3 color=mix(uHorizon,uTop,smoothstep(-0.04,0.65,h));
          color=mix(uTop*1.6+uHorizon*0.1,color,smoothstep(-0.25,0.02,h));
          gl_FragColor=vec4(color,1.0); }`,
    }))
    this.skyGroup.add(sky)
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(125, 125), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uAlpha: this.sky.alpha },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform float uAlpha; varying vec2 vUv;void main(){
        vec2 p=vUv-0.5;float d=length(p);if(d>0.5)discard;
        if(vUv.y<0.47 && mod(vUv.y,0.071)<0.018+(0.47-vUv.y)*0.05)discard;
        vec3 col=mix(vec3(1.0,0.24,0.29),vec3(1.0,0.84,0.47),vUv.y);
        gl_FragColor=vec4(col,smoothstep(0.5,0.489,d)*uAlpha);}`,
    }))
    sun.position.set(-58, 81, -440)
    this.skyGroup.add(sun)
    const stars = new Float32Array(190 * 3)
    const random = seeded(111)
    for (let i = 0; i < stars.length; i += 3) {
      stars[i] = (random() - 0.5) * 1300; stars[i + 1] = 180 + random() * 400; stars[i + 2] = -500 - random() * 180
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3))
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffd6c7, size: 1.1, fog: false, transparent: true, opacity: 0.6 }))
    this.skyGroup.add(this.stars)
    this.scene.add(this.skyGroup)
  }

  private buildLandscape() {
    this.floorMaterial = curved(new THREE.MeshBasicMaterial({ color: LOOKS[0].ground }))
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 1800, 1, 90), this.floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.35, -450)
    this.scene.add(floor)
    for (const side of [-1, 1]) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 1400, 1, 70), curved(new THREE.MeshStandardMaterial({
        color: 0x1d4f6e, roughness: 0.18, metalness: 0.7, transparent: true, opacity: 0, depthWrite: false,
      })))
      water.rotation.x = -Math.PI / 2
      water.position.set(side * (70 + 450), -0.31, -400)
      this.water.push(water)
      this.scene.add(water)
    }
    const lines: number[] = []
    for (let x = -600; x <= 600; x += 20) for (let z = -900; z < 60; z += 20) lines.push(x, 0, z, x, 0, z + 20)
    for (let z = -900; z <= 60; z += 20) lines.push(-600, 0, z, 600, 0, z)
    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    this.grid = new THREE.LineSegments(gridGeometry, curved(new THREE.LineBasicMaterial({ color: 0x725069, transparent: true, opacity: 0.55 })))
    this.grid.position.y = -0.3
    this.scene.add(this.grid)
    const random = seeded(8723)
    for (let layer = 0; layer < 3; layer++) {
      const positions: number[] = []
      for (let i = 0; i < 60; i++) {
        const x = -900 + i * 30
        const height = 18 + random() * (layer === 0 ? 100 : 62)
        positions.push(x, -5, -590 + layer * 50, x + 15, height, -590 + layer * 50, x + 45, -5, -590 + layer * 50)
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const material = curved(new THREE.MeshBasicMaterial({ color: LOOKS[0].mountains[layer], fog: false, side: THREE.DoubleSide }))
      this.mountainMaterials.push(material)
      this.scene.add(new THREE.Mesh(geometry, material))
    }
  }

  private buildRoad() {
    const roadParts: Part[] = []
    part(roadParts, 0x202132, 0, -0.17, -250, 22, 0.3, 650, 0, 90)
    for (const side of [-1, 1]) {
      part(roadParts, 0x5f586a, side * 11.2, -0.055, -250, 0.5, 0.08, 650, 0, 90)
      part(roadParts, 0x879192, side * 12, 0.68, -250, 0.16, 0.16, 650, 0, 90)
      part(roadParts, 0x4c5161, side * 12, 0.41, -250, 0.12, 0.12, 650, 0, 90)
    }
    const road = bake(roadParts)
    this.roadMaterial = road.material as THREE.MeshStandardMaterial
    this.scene.add(road)
    const edges: Part[] = []
    for (const side of [-1, 1]) {
      part(edges, 0xfdd7b8, side * 10.5, 0.008, -250, 0.13, 0.014, 650, 0, 90)
      part(edges, coral, side * 12, 0.8, -250, 0.13, 0.028, 650, 0, 90)
    }
    this.scene.add(bake(edges, true))
  }

  private buildProps() {
    const random = seeded(31337)
    const group = (...meshes: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...meshes); return g }
    // Palm
    const palmParts: Part[] = []
    for (let i = 0; i < 6; i++) part(palmParts, 0x292332, 0.08 * i, i * 1.15 + 0.6, 0, 0.42 - i * 0.025, 1.24, 0.42, -0.07)
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2
      const geometry = new THREE.BufferGeometry()
      const points = [0.5, 7.15, 0, Math.cos(angle) * 2.1, 7.6, Math.sin(angle) * 2.1,
        Math.cos(angle + 0.14) * 4.15, 6.45, Math.sin(angle + 0.14) * 4.15,
        0.5, 7.15, 0, Math.cos(angle + 0.14) * 4.15, 6.45, Math.sin(angle + 0.14) * 4.15,
        Math.cos(angle + 0.32) * 2.4, 7.35, Math.sin(angle + 0.32) * 2.4]
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
      geometry.computeVertexNormals()
      // Box pieces are indexed; make leaf geometry indexed for the shared bake.
      geometry.setIndex([0, 1, 2, 3, 4, 5])
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2))
      palmParts.push({ geometry, color: i % 2 ? 0x344c50 : 0x25444b })
    }
    const palm = bake(palmParts)
    palm.material.side = THREE.DoubleSide
    const tallPalm = group(palm.clone()); tallPalm.scale.setScalar(1.45)
    // Downtown billboard
    const billboard = (color: number, text: string) => {
      const frame: Part[] = []
      part(frame, 0x2d2f3d, 0, 3.5, 0, 0.3, 7, 0.3)
      part(frame, 0x1a1b25, 0, 8.2, 0, 7.4, 3.4, 0.25)
      const map = canvasTexture(256, 112, context => {
        context.fillStyle = '#120d1c'; context.fillRect(0, 0, 256, 112)
        context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`; context.lineWidth = 6; context.strokeRect(8, 8, 240, 96)
        context.fillStyle = context.strokeStyle; context.font = 'bold italic 44px Impact, sans-serif'; context.textAlign = 'center'
        context.fillText(text, 128, 72)
      })
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), curved(new THREE.MeshBasicMaterial({ map })))
      panel.position.set(0, 8.2, 0.14)
      const g = group(bake(frame), panel)
      g.rotation.y = 0.35
      return g
    }
    const hedge: Part[] = []
    part(hedge, 0x1f3a35, 0, 0.7, 0, 3, 1.4, 5)
    part(hedge, 0x284a42, 0, 1.5, 0, 2.4, 0.4, 4.4)
    // Canyon cactus and boulder
    const cactus: Part[] = []
    part(cactus, 0x3c6a45, 0, 2.4, 0, 0.7, 4.8, 0.7)
    part(cactus, 0x3c6a45, -0.8, 2.6, 0, 0.5, 1.6, 0.5)
    part(cactus, 0x3c6a45, -0.8, 1.9, 0, 1.2, 0.45, 0.5)
    part(cactus, 0x3c6a45, 0.8, 3.1, 0, 0.5, 1.8, 0.5)
    part(cactus, 0x3c6a45, 0.7, 2.4, 0, 1, 0.45, 0.5)
    const boulder: Part[] = []
    part(boulder, 0x8b3f2a, 0, 1.1, 0, 3.6, 2.2, 3, 0.2)
    part(boulder, 0x9c4a31, 0.6, 2.2, 0.3, 2.2, 1.4, 2.2, -0.3)
    // Storm causeway pylon
    const pylon: Part[] = []
    part(pylon, 0x3b4656, 0, 7, 0, 1.1, 14, 1.1)
    part(pylon, 0x2c3542, 0, 14.4, 0, 2.4, 0.8, 1.6)
    const pylonLight = new THREE.Mesh(box, curved(new THREE.MeshBasicMaterial({ color: 0xff3040 })))
    pylonLight.scale.set(0.5, 0.5, 0.5); pylonLight.position.set(0, 15.1, 0)
    const buoy: Part[] = []
    part(buoy, 0xc8553f, 0, 0.6, 0, 1.2, 1.4, 1.2)
    part(buoy, 0xeae0cf, 0, 1.6, 0, 0.3, 1.2, 0.3)
    const empty = () => new THREE.Group()
    this.propTemplates.near = [
      [group(palm), group(palm.clone()), tallPalm],
      [billboard(0x83ffe4, 'OVERDRIVE'), billboard(0xff6749, 'NITRO ×2'), billboard(0xffd36b, 'OPEN 24H'), group(bake(hedge))],
      [group(bake(cactus)), group(bake(boulder)), empty()],
      [group(bake(pylon), pylonLight), group(bake(buoy)), empty()],
    ]
    // Far scenery
    const tower = (height: number, width: number, accent: number) => {
      const shell: Part[] = [], windows: Part[] = []
      part(shell, [0x29283c, 0x3e314a, 0x31263d][Math.floor(random() * 3)], 0, height / 2 - 0.3, 0, width, height, 9)
      for (let y = 4; y < height; y += 4.2) {
        if (random() < 0.26) continue
        part(windows, random() < 0.3 ? 0x8abcb8 : 0xab796c, 0, y, 4.51, width * 0.65, 0.35, 0.035)
      }
      part(windows, accent, -width * 0.48, height / 2, 4.52, 0.065, height, 0.025)
      return group(bake(shell), bake(windows, true))
    }
    const house = (color: number) => {
      const shell: Part[] = [], windows: Part[] = []
      part(shell, color, 0, 2.2, 0, 9, 4.4, 7)
      part(shell, 0x3a2c3c, 0, 4.8, 0, 10, 0.8, 8)
      part(windows, 0xffc98a, -2, 2.4, 3.52, 1.8, 1.2, 0.03)
      part(windows, 0xffc98a, 2.2, 2.4, 3.52, 1.8, 1.2, 0.03)
      return group(bake(shell), bake(windows, true))
    }
    const mesa = (height: number, width: number) => {
      const rock: Part[] = []
      part(rock, 0x7e3526, 0, height * 0.35, 0, width, height * 0.7, width * 0.8)
      part(rock, 0x9c4a31, 0, height * 0.82, 0, width * 0.78, height * 0.36, width * 0.62)
      part(rock, 0xb45a38, 0, height + 0.3, 0, width * 0.7, 0.6, width * 0.56)
      return group(bake(rock))
    }
    const spire: Part[] = []
    part(spire, 0x8b3f2a, 0, 9, 0, 3.4, 18, 3.4, 0.05)
    part(spire, 0xa5503a, 0.3, 19, 0, 5, 2.2, 4.2)
    const lighthouse: Part[] = [], beacon: Part[] = []
    part(lighthouse, 0xd8d0c4, 0, 9, 0, 2.6, 18, 2.6)
    part(lighthouse, 0xc8553f, 0, 12, 0, 2.7, 2, 2.7)
    part(beacon, 0xfff0c0, 0, 19, 0, 1.6, 1.4, 1.6)
    const boat: Part[] = [], boatLights: Part[] = []
    part(boat, 0x2b2d3a, 0, 0.6, 0, 3, 1.2, 9)
    part(boat, 0xe8dfd0, 0, 1.9, 1, 2.2, 1.4, 3.4)
    part(boatLights, 0xffd08a, 0, 2, -0.72, 1.6, 0.4, 0.03)
    const turbine: Part[] = []
    part(turbine, 0xbfc6cc, 0, 14, 0, 0.7, 28, 0.7)
    for (let i = 0; i < 3; i++) part(turbine, 0xd7dde2, Math.cos(i * 2.094) * 4, 28 + Math.sin(i * 2.094) * 4, 0.6, 0.5, 8, 0.2, i * 2.094 - Math.PI / 2)
    this.propTemplates.far = [
      [house(0xd18a73), house(0x8f7fb1), house(0xe4c49a), group(palm.clone()), empty()],
      [tower(58, 14, mint), tower(38, 11, coral), tower(70, 16, 0xb9a0ff), tower(26, 18, mint), tower(46, 9, coral)],
      [mesa(26, 30), mesa(40, 24), mesa(16, 40), group(bake(spire)), empty()],
      [group(bake(lighthouse), bake(beacon, true)), group(bake(turbine)), empty(), empty()],
    ]
    this.propTemplates.ocean = [group(bake(boat), bake(boatLights, true)), empty(), empty()]
    const poleParts: Part[] = [], lampParts: Part[] = []
    part(poleParts, 0x3f495a, 0, 4.5, 0, 0.17, 9, 0.17)
    part(poleParts, 0x626174, -1.3, 9, 0, 2.7, 0.15, 0.15)
    part(lampParts, 0xffd4a0, -2.55, 8.91, 0, 1.35, 0.08, 0.5)
    const lamp = group(bake(poleParts), bake(lampParts, true))
    for (let i = 0; i < 28; i++) {
      const slot = new THREE.Group()
      const side = i % 2 ? 1 : -1
      const streetLight = lamp.clone()
      streetLight.position.x = side * 12.8
      streetLight.rotation.y = side < 0 ? Math.PI : 0
      slot.add(streetLight)
      slot.userData = { side, index: i }
      slot.position.z = 40 - i * 18
      this.scene.add(slot)
      this.nearSlots.push(slot)
    }
    for (let i = 0; i < 36; i++) {
      const slot = new THREE.Group()
      slot.userData = { side: i % 2 ? 1 : -1, index: i }
      slot.position.z = 40 - i * 14
      this.scene.add(slot)
      this.farSlots.push(slot)
    }
    this.fillSlots(0)
  }

  private dress(slot: THREE.Group, far: boolean, zone: number) {
    const old = slot.getObjectByName('prop')
    if (old) slot.remove(old)
    const side = slot.userData.side as number
    // The coast has open ocean on the left; the causeway has water on both sides.
    const oceanSide = (zone === 0 && side < 0) || zone === 3
    const options = far ? (oceanSide && zone === 0 ? this.propTemplates.ocean : this.propTemplates.far[zone]) : this.propTemplates.near[zone]
    const prop = options[Math.floor(this.propRandom() * options.length)].clone()
    prop.name = 'prop'
    if (far) {
      prop.position.x = side * (oceanSide ? 80 + this.propRandom() * 90 : 34 + this.propRandom() * 120)
      prop.rotation.y = oceanSide ? this.propRandom() * Math.PI : 0
    } else {
      prop.position.x = side * (zone === 3 ? 14 : 17 + this.propRandom() * 4)
      if (zone !== 1) prop.rotation.y = this.propRandom() * Math.PI * 2
      else prop.rotation.y = side < 0 ? 0.35 : -0.35
      prop.scale.setScalar(zone === 1 ? 1 : 0.85 + this.propRandom() * 0.45)
    }
    slot.add(prop)
  }

  private fillSlots(distance: number) {
    for (const slot of this.nearSlots) this.dress(slot, false, this.zoneIndexAt(distance + PLAYER_Z - slot.position.z))
    for (const slot of this.farSlots) this.dress(slot, true, this.zoneIndexAt(distance + PLAYER_Z - slot.position.z))
  }

  private zoneIndexAt(distance: number) { return ZONES.indexOf(zoneAt(distance)) }

  private buildGate() {
    const gateParts: Part[] = [], gateLights: Part[] = []
    for (const x of [-12.3, 12.3]) part(gateParts, 0x39394d, x, 6.6, 0, 0.45, 13.2, 0.55)
    part(gateParts, 0x333344, 0, 12.5, 0, 25, 1.5, 0.6)
    part(gateLights, coral, 0, 13.2, 0.34, 25, 0.12, 0.06)
    part(gateLights, mint, 0, 11.8, 0.34, 25, 0.06, 0.06)
    for (let i = 0; i < 12; i++) part(gateLights, i % 2 ? 0xf2f2f2 : 0x14141c, -11 + i * 2, 0.02, 0, 2, 0.02, 1.6)
    this.gate.add(bake(gateParts), bake(gateLights, true))
    this.gateSign = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.63), curved(new THREE.MeshBasicMaterial()))
    this.gateSign.position.set(0, 12.4, 0.35)
    this.gate.add(this.gateSign)
    this.gate.visible = false
    this.scene.add(this.gate)
  }

  private labelGate(zoneIndex: number) {
    if (this.gateTarget === zoneIndex) return
    this.gateTarget = zoneIndex
    this.gateSign.material.map?.dispose()
    const zone = ZONES[zoneIndex % ZONES.length]
    this.gateSign.material.map = canvasTexture(1024, 112, context => {
      context.fillStyle = '#192c35'; context.fillRect(0, 0, 1024, 112)
      context.fillStyle = '#b6eed7'; context.textAlign = 'center'; context.font = 'bold 46px monospace'
      context.fillText(`CHECKPOINT ${String(zoneIndex).padStart(2, '0')}  //  ${zone.name.toUpperCase()}`, 512, 72)
    })
    this.gateSign.material.needsUpdate = true
  }

  private makePickupTemplates() {
    for (const repair of [false, true]) {
      const group = new THREE.Group()
      const color = repair ? 0xffc875 : mint
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.045, 6, 24), curved(new THREE.MeshBasicMaterial({ color })))
      group.add(ring)
      const symbol: Part[] = []
      if (repair) {
        part(symbol, color, 0, 0, 0, 0.23, 0.85, 0.14)
        part(symbol, color, 0, 0, 0, 0.85, 0.23, 0.14)
      } else {
        part(symbol, color, -0.06, 0.19, 0, 0.22, 0.65, 0.17, -0.5)
        part(symbol, color, 0.06, -0.19, 0, 0.22, 0.65, 0.17, -0.5)
      }
      group.add(bake(symbol, true))
      this.pickupTemplates.push(group)
    }
  }

  private makeHazardTemplates() {
    const ramp = new THREE.Group()
    const length = 6.4, rise = 1.35, width = 3.6
    const wedge = new THREE.BoxGeometry(width, 1, length)
    const position = wedge.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > 0) position.setY(i, position.getZ(i) < 0 ? rise : 0.04)
      else position.setY(i, 0)
    }
    wedge.computeVertexNormals()
    ramp.add(new THREE.Mesh(wedge, curved(new THREE.MeshStandardMaterial({ color: 0x3a3a4f, roughness: 0.5, metalness: 0.3 }))))
    const angle = Math.atan2(rise, length)
    const stripes: Part[] = []
    for (let i = 0; i < 5; i++) {
      const z = length / 2 - 0.8 - i * 1.2
      const geometry = box.clone()
      geometry.scale(width * 0.86, 0.04, 0.4)
      geometry.rotateX(angle)
      geometry.translate(0, rise * (0.5 - z / length) + 0.04, z)
      stripes.push({ geometry, color: i % 2 ? 0xffd36b : coral })
    }
    for (const x of [-width / 2, width / 2]) part(stripes, coral, x, rise / 2, -length / 2 + 0.05, 0.12, rise, 0.1)
    ramp.add(bake(stripes, true))
    const pad = new THREE.Group()
    const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.8), curved(new THREE.MeshBasicMaterial({ map: this.padTexture, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })))
    padMesh.rotation.x = -Math.PI / 2
    padMesh.position.y = 0.03
    pad.add(padMesh)
    const oil = new THREE.Group()
    const slick = new THREE.Mesh(new THREE.CircleGeometry(1, 28), curved(new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.05, metalness: 0.9 })))
    slick.rotation.x = -Math.PI / 2
    slick.scale.set(2, 2.6, 1)
    slick.position.y = 0.025
    const sheen = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), curved(new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })))
    sheen.rotation.x = -Math.PI / 2
    sheen.scale.set(2, 2.6, 1)
    sheen.position.y = 0.03
    oil.add(slick, sheen)
    return { ramp, pad, oil }
  }

  burst(x: number, kind: BurstKind = 'spark', y = 0.7) {
    if (kind === 'crash') this.shake = 0.8
    if (kind === 'dust') this.shake = Math.max(this.shake, 0.35)
    const count = kind === 'crash' ? 32 : kind === 'dust' ? 26 : 15
    for (let i = 0; i < count; i++) {
      const life = 0.3 + Math.random() * 0.55
      this.particles.push({ life, maxLife: life, x, y, z: PLAYER_Z,
        vx: (Math.random() - 0.5) * (kind === 'dust' ? 18 : 14), vy: Math.random() * (kind === 'dust' ? 4 : 8), vz: Math.random() * 15,
        color: new THREE.Color(burstColors[kind]) })
    }
    if (this.particles.length > 200) this.particles.splice(0, this.particles.length - 200)
  }

  reset() {
    this.traffic.forEach(view => this.scene.remove(view.object)); this.traffic.clear()
    this.pickups.forEach(pickup => this.scene.remove(pickup)); this.pickups.clear()
    this.hazards.forEach(hazard => this.scene.remove(hazard)); this.hazards.clear()
    this.particles = []; this.shake = 0; this.flash = 0
    this.player.visible = true
    this.gate.visible = false
    this.fillSlots(0)
  }

  private applyLook(zoneIndex: number, dt: number) {
    const target = LOOKS[zoneIndex % LOOKS.length]
    const k = 1 - Math.exp(-dt * 0.8)
    const approach = (value: number, goal: number) => value + (goal - value) * k
    this.sky.horizon.lerp(tmp.setHex(target.horizon, THREE.LinearSRGBColorSpace), k)
    this.sky.top.lerp(tmp.setHex(target.top, THREE.LinearSRGBColorSpace), k)
    this.sky.alpha.value = approach(this.sky.alpha.value, target.sun)
    const fog = this.scene.fog as THREE.Fog
    fog.color.lerp(tmp.setHex(target.fog), k)
    this.renderer.setClearColor(fog.color)
    const look = this.look
    look.fogNear = approach(look.fogNear, target.fogNear); look.fogFar = approach(look.fogFar, target.fogFar)
    fog.near = look.fogNear; fog.far = look.fogFar
    this.floorMaterial.color.lerp(tmp.setHex(target.ground), k)
    this.mountainMaterials.forEach((material, i) => material.color.lerp(tmp.setHex(target.mountains[i]), k))
    look.night = approach(look.night, target.night)
    look.wet = approach(look.wet, target.wet)
    look.hemi = approach(look.hemi, target.hemi); look.key = approach(look.key, target.key)
    for (let side = 0; side < 2; side++) {
      look.water[side] = approach(look.water[side], target.water[side])
      look.waterEdge[side] = approach(look.waterEdge[side], target.waterEdge[side])
      const water = this.water[side]
      water.material.opacity = look.water[side] * 0.92
      water.visible = look.water[side] > 0.02
      water.position.x = (side ? 1 : -1) * (look.waterEdge[side] + 450)
    }
    this.roadMaterial.roughness = 0.65 - look.wet * 0.25
    this.roadMaterial.metalness = 0.12 + look.wet * 0.2
    this.stars.material.opacity = 0.6 * (1 - look.wet)
  }

  render(dt: number, race: Race, state: string, braking = false) {
    const driving = state === 'running'
    const menu = state === 'menu'
    const animated = driving || menu
    if (animated) this.elapsed += dt
    const speed = driving ? race.speed / 3.6 : menu ? 20 : 0
    if (menu) this.menuDistance += speed * dt
    const distance = menu ? this.menuDistance % ZONE_LENGTH : race.distance
    const zoneIndex = menu ? 0 : race.zoneIndex
    this.applyLook(zoneIndex, animated ? dt : 0)
    this.curveView = THREE.MathUtils.damp(this.curveView, roadCurve(distance + 110), 3, dt)
    this.hillView = THREE.MathUtils.damp(this.hillView, roadHill(distance + 150), 2, dt)
    bend.value.set(this.curveView * 0.00042, this.hillView * 0.00011)
    this.skyGroup.rotation.y = this.curveView * 0.3
    this.motion += speed * dt
    const stride = 14
    for (let i = 0; i < 44; i++) {
      const z = 30 - i * stride + this.motion % stride
      for (let lane = 0; lane < 3; lane++) {
        dummy.position.set((lane - 1) * 5, 0.01, z)
        dummy.scale.set(0.11, 0.016, 5.2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix()
        this.roadDashes.setMatrixAt(i * 3 + lane, dummy.matrix)
      }
      for (let side = 0; side < 2; side++) {
        dummy.position.set(side ? 11.85 : -11.85, 0.4, z)
        dummy.scale.set(0.13, 0.75, 0.15); dummy.updateMatrix()
        this.roadStuds.setMatrixAt(i * 2 + side, dummy.matrix)
      }
    }
    this.roadDashes.instanceMatrix.needsUpdate = true
    this.roadStuds.instanceMatrix.needsUpdate = true
    this.grid.position.z = this.motion % 20
    for (const [slots, far] of [[this.nearSlots, false], [this.farSlots, true]] as const) {
      for (const slot of slots) {
        slot.position.z += speed * dt
        if (slot.position.z > 48) {
          slot.position.z -= SLOT_SPAN
          this.dress(slot, far, this.zoneIndexAt(distance + PLAYER_Z - slot.position.z))
        }
      }
    }
    if (driving) {
      this.labelGate(race.zoneIndex + 1)
      const ahead = race.nextCheckpoint
      this.gate.visible = ahead < 470
      this.gate.position.z = PLAYER_Z - ahead
    } else if (menu) this.gate.visible = false
    const height = driving ? race.height : 0
    const desiredX = menu ? 4.7 : race.x
    this.player.position.x = THREE.MathUtils.damp(this.player.position.x, desiredX, 14, dt)
    this.player.position.y = 0.03 + height + (animated && !height ? Math.sin(this.elapsed * 25) * 0.012 * Math.min(speed / 40, 1) : 0)
    const spinYaw = driving && race.spin ? Math.sin(race.spin * 11) * 0.55 * race.spin : 0
    this.player.rotation.y = THREE.MathUtils.damp(this.player.rotation.y, menu ? -0.05 : -race.lateralSpeed * (race.drifting ? 0.045 : 0.019) + spinYaw, 9, dt)
    this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, menu ? 0 : -race.lateralSpeed * 0.009 + this.curveView * 0.03, 8, dt)
    const pitch = height ? (0.5 - (1 - race.air / race.airDuration)) * 0.32 : 0
    this.player.rotation.x = THREE.MathUtils.damp(this.player.rotation.x, pitch, 10, dt)
    this.playerShadow.position.y = 0.024 - height
    this.playerShadow.scale.setScalar(Math.max(0.45, 1 - height * 0.12))
    this.player.visible = race.invulnerable === 0 || !driving || Math.floor(this.elapsed * 14) % 2 === 0
    this.playerBrake.visible = driving && braking
    this.flames.visible = driving && (race.boosting || race.surge > 0)
    this.flames.scale.z = 0.75 + Math.sin(this.elapsed * 49) * 0.23
    this.underglow.material.opacity = race.boosting ? 0.32 : race.drafting ? 0.24 : 0.13
    this.headlights.material.opacity = this.look.night * 0.5
    const blinkOn = Math.floor(this.elapsed * 3.2) % 2 === 0
    const existingTraffic = new Set<number>()
    for (const car of race.traffic) {
      existingTraffic.add(car.id)
      let view = this.traffic.get(car.id)
      if (!view) view = this.addTraffic(car)
      const object = view.object
      object.position.set(car.x, 0.02, car.z)
      const lateral = dt > 0 ? (car.x - view.lastX) / dt : 0
      object.rotation.y = THREE.MathUtils.damp(object.rotation.y, -lateral * 0.06, 6, dt)
      view.lastX = car.x
      view.brake.visible = !!car.brakeTime || this.look.night > 0.6
      view.brake.scale.setScalar(car.brakeTime ? 1 : 0.7)
      view.left.visible = car.signal === -1 && blinkOn
      view.right.visible = car.signal === 1 && blinkOn
    }
    for (const [id, view] of this.traffic) if (!existingTraffic.has(id)) { this.scene.remove(view.object); this.traffic.delete(id) }
    const existingPickups = new Set<number>()
    for (const pickup of race.pickups) {
      existingPickups.add(pickup.id)
      let object = this.pickups.get(pickup.id)
      if (!object) {
        object = this.pickupTemplates[pickup.repair ? 1 : 0].clone()
        this.pickups.set(pickup.id, object); this.scene.add(object)
      }
      object.position.set(pickup.x, 1.38 + Math.sin(this.elapsed * 3 + pickup.id) * 0.17, pickup.z)
      object.rotation.y = this.elapsed * 1.4
    }
    for (const [id, object] of this.pickups) if (!existingPickups.has(id)) { this.scene.remove(object); this.pickups.delete(id) }
    const existingHazards = new Set<number>()
    for (const hazard of race.hazards) {
      existingHazards.add(hazard.id)
      let object = this.hazards.get(hazard.id)
      if (!object) {
        object = this.hazardTemplates[hazard.kind].clone()
        this.hazards.set(hazard.id, object); this.scene.add(object)
      }
      object.position.set(hazard.x, 0, hazard.z)
    }
    for (const [id, object] of this.hazards) if (!existingHazards.has(id)) { this.scene.remove(object); this.hazards.delete(id) }
    if (animated) this.padTexture.offset.y = (this.padTexture.offset.y + dt * 2.2) % 1
    if (driving && (race.drifting || race.spin) && this.particles.length < 190) {
      this.particles.push({ life: 0.55, maxLife: 0.55, x: race.x + (Math.random() < 0.5 ? 1 : -1), y: 0.2, z: PLAYER_Z + 1.7,
        vx: -race.lateralSpeed * 0.4, vy: 0.7, vz: 14, color: new THREE.Color(race.spin ? 0x6a4a8f : 0xb1afb9) })
    }
    if (driving && this.look.wet > 0.5 && speed > 30 && this.particles.length < 170 && Math.random() < 0.5) {
      this.particles.push({ life: 0.4, maxLife: 0.4, x: race.x + (Math.random() - 0.5) * 2, y: 0.25, z: PLAYER_Z + 2.4,
        vx: (Math.random() - 0.5) * 3, vy: 2.5, vz: 10, color: new THREE.Color(0x9fb4c8) })
    }
    if (animated) {
      this.particles = this.particles.filter(particle => {
        particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt
        particle.vy -= 12 * dt; particle.z += particle.vz * dt
        return particle.life > 0 && particle.y > 0
      })
    }
    this.particleMesh.count = this.particles.length
    this.particles.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.life * 3, p.life, p.life * 5)
      dummy.scale.setScalar(0.13 * p.life / p.maxLife + 0.02); dummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, dummy.matrix); this.particleMesh.setColorAt(i, p.color)
    })
    this.particleMesh.instanceMatrix.needsUpdate = true
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true
    this.updateWeather(dt, speed, animated)
    const rush = driving ? THREE.MathUtils.clamp((race.speed - 250) / 70, 0, 1) : 0
    this.streaks.material.opacity = THREE.MathUtils.damp(this.streaks.material.opacity, this.reducedMotion ? 0 : rush * 0.55, 5, dt)
    this.streaks.visible = this.streaks.material.opacity > 0.01
    if (this.streaks.visible) {
      this.streakData.forEach((streak, i) => {
        streak.z += speed * dt * 1.6
        if (streak.z > 16) streak.z -= 90
        dummy.position.set(streak.x, streak.y, streak.z); dummy.rotation.set(0, 0, 0)
        dummy.scale.set(0.04, 0.04, 4 + rush * 6); dummy.updateMatrix()
        this.streaks.setMatrixAt(i, dummy.matrix)
      })
      this.streaks.instanceMatrix.needsUpdate = true
    }
    this.shake = Math.max(0, this.shake - dt * 2)
    const shake = this.reducedMotion ? 0 : this.shake + rush * 0.12
    const portrait = this.camera.aspect < 0.85
    const cameraX = menu ? 8.8 : race.x * 0.42
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, cameraX, 4, dt) + (Math.random() - 0.5) * shake * 0.12
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y || 6, (menu ? 5.2 : portrait ? 9 : 6.3) + height * 0.45, 4, dt) + (Math.random() - 0.5) * shake * 0.06
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z || 16, menu ? 15 : portrait ? 22 : 16, 4, dt)
    this.camera.lookAt(menu ? -2 : race.x * 0.28, (menu ? 2 : 1.2) + height * 0.3, -30)
    if (!this.reducedMotion) this.camera.rotateZ(-this.curveView * 0.05)
    const kick = driving && !this.reducedMotion ? (race.boosting ? 8 : 0) + (race.surge ? 5 : 0) : 0
    const fov = (portrait ? 66 : 58) + kick
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 4, dt)
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
    // Keep low-powered devices playable instead of insisting on retina rendering.
    this.performanceTime += dt; this.frameCount++
    if (this.performanceTime >= 4) {
      if (this.frameCount / this.performanceTime < 38 && this.renderer.getPixelRatio() > 1) {
        this.renderer.setPixelRatio(1)
        this.renderer.setSize(innerWidth, innerHeight)
      }
      this.performanceTime = 0; this.frameCount = 0
    }
  }

  private addTraffic(car: Traffic) {
    const object = this.trafficTemplates[car.color][car.truck ? 1 : 0].clone()
    const view: TrafficView = {
      object, lastX: car.x,
      brake: object.getObjectByName('brake')!, left: object.getObjectByName('blinkL')!, right: object.getObjectByName('blinkR')!,
    }
    this.traffic.set(car.id, view)
    this.scene.add(object)
    return view
  }

  private updateWeather(dt: number, speed: number, animated: boolean) {
    const wet = this.look.wet
    this.rain.material.opacity = wet * 0.5
    this.rain.visible = wet > 0.02
    if (this.rain.visible && animated) {
      const d = this.rainDrops
      for (let i = 0; i < d.length / 6; i++) {
        let y = d[i * 6 + 1] - 34 * dt
        let z = d[i * 6 + 2] + speed * dt * 0.35
        let x = d[i * 6]
        if (y < -0.5 || z > 22) { y = 26 + Math.random() * 6; z = -90 + Math.random() * 105; x = this.camera.position.x + (Math.random() - 0.5) * 80 }
        this.placeDrop(i, x, y, z)
      }
      this.rain.geometry.getAttribute('position').needsUpdate = true
    }
    // Lightning only when the storm has fully rolled in.
    if (animated && wet > 0.7 && !this.reducedMotion && Math.random() < dt * 0.14) this.flash = 1
    this.flash = Math.max(0, this.flash - dt * 3.5)
    const flicker = this.flash > 0 ? this.flash * (0.6 + Math.random() * 0.4) : 0
    this.hemi.intensity = this.look.hemi + flicker * 7
    this.key.intensity = this.look.key
  }

  dispose() {
    this.resizeObserver.disconnect()
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    const collect = (root: THREE.Object3D) => root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
      }
    })
    collect(this.scene)
    this.trafficTemplates.flat().forEach(collect); this.pickupTemplates.forEach(collect)
    Object.values(this.hazardTemplates).forEach(collect)
    ;[...this.propTemplates.near.flat(), ...this.propTemplates.far.flat(), ...this.propTemplates.ocean].forEach(collect)
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
      material.dispose()
    })
    this.renderer.dispose(); this.renderer.domElement.remove()
  }
}
