import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PLAYER_Z, type Race } from './race'

type Part = { geometry: THREE.BufferGeometry; color: THREE.ColorRepresentation }
type Particle = { life: number; maxLife: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; color: THREE.Color }
const coral = 0xff6749
const mint = 0x83ffe4
const palette = [0xf1c75b, 0x48b5bb, 0xb1a0d4, 0xe7ddd0, 0xc76e65, 0x518fa5]
const box = new THREE.BoxGeometry(1, 1, 1)
const dummy = new THREE.Object3D()

function part(parts: Part[], color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0) {
  const geometry = box.clone()
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
  return new THREE.Mesh(geometry, luminous
    ? new THREE.MeshBasicMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.12 }))
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
    part(lights, 0xff354b, x * 0.67, 0.85, length / 2 + 0.013, 0.63, 0.14, 0.035)
  }
  group.add(bake(body), bake(lights, true))
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.15, length + 0.55), new THREE.MeshBasicMaterial({ color: 0x080814, transparent: true, opacity: 0.4, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.024
  group.add(shadow)
  return group
}

function seeded(seed: number) {
  return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
}

export class HighwayWorld {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1300)
  private player = buildCar(coral)
  private traffic = new Map<number, THREE.Group>()
  private trafficTemplates = palette.map(color => [buildCar(color), buildCar(color, true)])
  private pickups = new Map<number, THREE.Group>()
  private pickupTemplates: THREE.Group[] = []
  private roadDashes: THREE.InstancedMesh
  private roadStuds: THREE.InstancedMesh
  private scenery: THREE.Group[] = []
  private particleMesh: THREE.InstancedMesh
  private particles: Particle[] = []
  private flames = new THREE.Group()
  private underglow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
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
    this.renderer.domElement.setAttribute('aria-label', '3D sunset highway. Dodge traffic using A and D or the arrow keys. Shift boosts, Space drifts, and P pauses.')
    this.renderer.domElement.setAttribute('role', 'img')
    container.append(this.renderer.domElement)
    this.scene.fog = new THREE.Fog(0x70445b, 115, 360)
    this.scene.add(new THREE.HemisphereLight(0xf7bdb0, 0x67608b, 3))
    const sunLight = new THREE.DirectionalLight(0xffc6a3, 3)
    sunLight.position.set(-20, 45, -75)
    this.scene.add(sunLight)
    const rim = new THREE.DirectionalLight(0x66e4e2, 1.6)
    rim.position.set(10, 15, 12)
    this.scene.add(rim)
    this.buildSky()
    this.buildLandscape()
    const roadParts: Part[] = []
    part(roadParts, 0x202132, 0, -0.17, -250, 22, 0.3, 650)
    for (const side of [-1, 1]) {
      part(roadParts, 0x5f586a, side * 11.2, -0.055, -250, 0.5, 0.08, 650)
      part(roadParts, 0x879192, side * 12, 0.68, -250, 0.16, 0.16, 650)
      part(roadParts, 0x4c5161, side * 12, 0.41, -250, 0.12, 0.12, 650)
    }
    this.scene.add(bake(roadParts))
    const edges: Part[] = []
    for (const side of [-1, 1]) {
      part(edges, 0xfdd7b8, side * 10.5, 0.008, -250, 0.13, 0.014, 650)
      part(edges, coral, side * 12, 0.8, -250, 0.13, 0.028, 650)
    }
    this.scene.add(bake(edges, true))
    this.roadDashes = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xb5bbbf }), 132)
    this.roadDashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.roadDashes.frustumCulled = false
    this.scene.add(this.roadDashes)
    this.roadStuds = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xff956c }), 88)
    this.roadStuds.frustumCulled = false
    this.scene.add(this.roadStuds)
    this.buildRoadside()
    this.player.position.set(0, 0.05, PLAYER_Z)
    this.scene.add(this.player)
    this.underglow = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 4.6), new THREE.MeshBasicMaterial({ color: mint, transparent: true, opacity: 0.19, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.underglow.rotation.x = -Math.PI / 2
    this.underglow.position.set(0, 0.03, 0)
    this.player.add(this.underglow)
    for (const x of [-0.67, 0.67]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.1, 8), new THREE.MeshBasicMaterial({ color: mint, transparent: true, opacity: 0.9 }))
      flame.rotation.x = Math.PI / 2
      flame.position.set(x, 0.45, 3.05)
      this.flames.add(flame)
    }
    this.player.add(this.flames)
    this.particleMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, opacity: 0.8 }), 160)
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particleMesh.frustumCulled = false
    this.particleMesh.count = 0
    this.scene.add(this.particleMesh)
    this.makePickupTemplates()
    this.resizeObserver = new ResizeObserver(() => this.resize(container))
    this.resizeObserver.observe(container)
    this.resize(container)
  }

  private resize(container: HTMLElement) {
    const width = container.clientWidth, height = container.clientHeight
    this.renderer.setSize(width, height)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  private buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vPosition;
        void main(){ float h=normalize(vPosition).y;
          vec3 horizon=vec3(0.88,0.36,0.27); vec3 top=vec3(0.075,0.047,0.16);
          vec3 color=mix(horizon,top,smoothstep(-0.04,0.65,h));
          color=mix(vec3(0.18,0.10,0.22),color,smoothstep(-0.25,0.02,h));
          gl_FragColor=vec4(color,1.0); }`,
    }))
    this.scene.add(sky)
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(125, 125), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv;void main(){
        vec2 p=vUv-0.5;float d=length(p);if(d>0.5)discard;
        if(vUv.y<0.47 && mod(vUv.y,0.071)<0.018+(0.47-vUv.y)*0.05)discard;
        vec3 col=mix(vec3(1.0,0.24,0.29),vec3(1.0,0.84,0.47),vUv.y);
        gl_FragColor=vec4(col,smoothstep(0.5,0.489,d));}`,
    }))
    sun.position.set(-58, 81, -440)
    this.scene.add(sun)
    const stars = new Float32Array(190 * 3)
    const random = seeded(111)
    for (let i = 0; i < stars.length; i += 3) {
      stars[i] = (random() - 0.5) * 1300; stars[i + 1] = 180 + random() * 400; stars[i + 2] = -500 - random() * 180
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3))
    this.scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffd6c7, size: 1.1, fog: false, transparent: true, opacity: 0.6 })))
  }

  private buildLandscape() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 1800), new THREE.MeshBasicMaterial({ color: 0x2d243e }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.35, -450)
    this.scene.add(floor)
    const grid = new THREE.GridHelper(1200, 70, 0x725069, 0x49334d)
    grid.position.set(0, -0.3, -350)
    this.scene.add(grid)
    const random = seeded(8723)
    for (let layer = 0; layer < 3; layer++) {
      const positions: number[] = []
      for (let i = 0; i < 48; i++) {
        const x = -700 + i * 30
        const height = 18 + random() * (layer === 0 ? 100 : 62)
        positions.push(x, -5, -590 + layer * 50, x + 15, height, -590 + layer * 50, x + 45, -5, -590 + layer * 50)
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      this.scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: [0x6d4059, 0x55334c, 0x3c2b44][layer], fog: false, side: THREE.DoubleSide })))
    }
    const buildings: Part[] = [], windows: Part[] = []
    for (let i = 0; i < 100; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const x = side * (32 + random() * 150)
      const z = -35 - random() * 460
      const height = 8 + random() * 56
      const w = 5 + random() * 14
      part(buildings, [0x29283c, 0x3e314a, 0x31263d][i % 3], x, height / 2 - 0.3, z, w, height, 9)
      for (let y = 4; y < height; y += 4.2) {
        if (random() < 0.26) continue
        part(windows, i % 4 === 0 ? 0x8abcb8 : 0xab796c, x, y, z + 4.51, w * 0.65, 0.35, 0.035)
      }
      if (i % 5 === 0) part(windows, mint, x - w * 0.48, height / 2, z + 4.52, 0.065, height, 0.025)
    }
    this.scene.add(bake(buildings), bake(windows, true))
  }

  private buildRoadside() {
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
    const poleParts: Part[] = [], lampParts: Part[] = []
    part(poleParts, 0x3f495a, 0, 4.5, 0, 0.17, 9, 0.17)
    part(poleParts, 0x626174, -1.3, 9, 0, 2.7, 0.15, 0.15)
    part(lampParts, 0xffd4a0, -2.55, 8.91, 0, 1.35, 0.08, 0.5)
    const lamp = new THREE.Group()
    lamp.add(bake(poleParts), bake(lampParts, true))
    for (let i = 0; i < 26; i++) {
      const cluster = new THREE.Group()
      const side = i % 2 ? 1 : -1
      const tree = palm.clone()
      tree.position.x = side * (17 + i % 3 * 1.7)
      tree.rotation.y = i * 2.4
      tree.scale.setScalar(1 + i % 4 * 0.17)
      cluster.add(tree)
      const streetLight = lamp.clone()
      streetLight.position.x = side * 12.8
      streetLight.rotation.y = side < 0 ? Math.PI : 0
      cluster.add(streetLight)
      cluster.position.z = 25 - i * 19
      this.scene.add(cluster)
      this.scenery.push(cluster)
    }
    const gate = new THREE.Group()
    const gateParts: Part[] = [], gateLights: Part[] = []
    for (const x of [-12.3, 12.3]) part(gateParts, 0x39394d, x, 6.6, 0, 0.45, 13.2, 0.55)
    part(gateParts, 0x333344, 0, 12.5, 0, 25, 1.5, 0.6)
    part(gateLights, coral, 0, 13.2, 0.34, 25, 0.12, 0.06)
    part(gateLights, mint, 0, 11.8, 0.34, 25, 0.06, 0.06)
    gate.add(bake(gateParts), bake(gateLights, true))
    const canvas = document.createElement('canvas')
    canvas.width = 1024; canvas.height = 128
    const context = canvas.getContext('2d')!
    context.fillStyle = '#192c35'; context.fillRect(0, 0, 1024, 128)
    context.fillStyle = '#b6eed7'; context.textAlign = 'center'; context.font = 'bold 49px monospace'
    context.fillText('↓  NEON DISTRICT  /  01  ↓', 512, 83)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.63), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }))
    sign.position.set(0, 12.4, 0.35)
    gate.add(sign); gate.position.z = -270
    this.scene.add(gate); this.scenery.push(gate)
  }

  private makePickupTemplates() {
    for (const repair of [false, true]) {
      const group = new THREE.Group()
      const color = repair ? 0xffc875 : mint
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.045, 6, 24), new THREE.MeshBasicMaterial({ color }))
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

  burst(x: number, crash = false) {
    this.shake = crash ? 0.8 : this.shake
    for (let i = 0; i < (crash ? 32 : 15); i++) {
      const life = 0.3 + Math.random() * 0.55
      this.particles.push({ life, maxLife: life, x, y: 0.7, z: PLAYER_Z,
        vx: (Math.random() - 0.5) * 14, vy: Math.random() * 8, vz: Math.random() * 15,
        color: new THREE.Color(crash ? 0xffb06a : mint) })
    }
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160)
  }

  reset() {
    this.traffic.forEach(car => this.scene.remove(car)); this.traffic.clear()
    this.pickups.forEach(pickup => this.scene.remove(pickup)); this.pickups.clear()
    this.particles = []; this.shake = 0
    this.player.visible = true
  }

  render(dt: number, race: Race, state: string) {
    const driving = state === 'running'
    const menu = state === 'menu'
    const animated = driving || menu
    if (animated) this.elapsed += dt
    const speed = driving ? race.speed / 3.6 : menu ? 20 : 0
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
    for (const item of this.scenery) {
      item.position.z += speed * dt
      if (item.position.z > 48) item.position.z -= 494
    }
    const desiredX = menu ? 4.7 : race.x
    this.player.position.x = THREE.MathUtils.damp(this.player.position.x, desiredX, 14, dt)
    this.player.position.y = 0.03 + (animated ? Math.sin(this.elapsed * 25) * 0.012 * Math.min(speed / 40, 1) : 0)
    this.player.rotation.y = THREE.MathUtils.damp(this.player.rotation.y, menu ? -0.05 : -race.lateralSpeed * (race.drifting ? 0.045 : 0.019), 9, dt)
    this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, menu ? 0 : -race.lateralSpeed * 0.009, 8, dt)
    this.player.visible = race.invulnerable === 0 || !driving || Math.floor(this.elapsed * 14) % 2 === 0
    this.flames.visible = driving && race.boosting
    this.flames.scale.z = 0.75 + Math.sin(this.elapsed * 49) * 0.23
    this.underglow.material.opacity = race.boosting ? 0.32 : 0.13
    const existingTraffic = new Set<number>()
    for (const car of race.traffic) {
      existingTraffic.add(car.id)
      let object = this.traffic.get(car.id)
      if (!object) {
        object = this.trafficTemplates[car.color][car.truck ? 1 : 0].clone()
        this.traffic.set(car.id, object); this.scene.add(object)
      }
      object.position.set(car.x, 0.02, car.z)
    }
    for (const [id, object] of this.traffic) if (!existingTraffic.has(id)) { this.scene.remove(object); this.traffic.delete(id) }
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
    if (driving && race.drifting && this.particles.length < 150) {
      this.particles.push({ life: 0.55, maxLife: 0.55, x: race.x + (Math.random() < 0.5 ? 1 : -1), y: 0.2, z: PLAYER_Z + 1.7,
        vx: -race.lateralSpeed * 0.4, vy: 0.7, vz: 14, color: new THREE.Color(0xb1afb9) })
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
    this.shake = Math.max(0, this.shake - dt * 2)
    const shake = this.reducedMotion ? 0 : this.shake
    const portrait = this.camera.aspect < 0.85
    const cameraX = menu ? 8.8 : race.x * 0.42
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, cameraX, 4, dt) + (Math.random() - 0.5) * shake * 0.12
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y || 6, menu ? 5.2 : portrait ? 9 : 6.3, 4, dt)
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z || 16, menu ? 15 : portrait ? 22 : 16, 4, dt)
    this.camera.lookAt(menu ? -2 : race.x * 0.28, menu ? 2 : 1.2, -30)
    const fov = (portrait ? 66 : 58) + (race.boosting && driving && !this.reducedMotion ? 8 : 0)
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
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
      material.dispose()
    })
    this.renderer.dispose(); this.renderer.domElement.remove()
  }
}