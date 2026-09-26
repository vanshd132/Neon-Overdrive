/** Pure fixed-step racing rules. Rendering, sound and input live outside this module. */
export type Mode = 'sprint' | 'endless'
export type Difficulty = 'chill' | 'normal' | 'expert'
export type RaceEvent = 'crash' | 'near' | 'pickup' | 'repair' | 'finish' | 'edge'
  | 'zone' | 'jump' | 'land' | 'vault' | 'pad' | 'oil'
  | 'mission-start' | 'mission-complete' | 'mission-fail'
export interface Controls { steer: number; brake: boolean; boost: boolean; drift: boolean }
export interface Traffic {
  id: number; x: number; z: number; speed: number; color: number; truck: boolean; passed: boolean
  lane?: number; phase?: number
  /** Blinker direction (-1/1) while waiting to move into `target`. */
  signal?: number; signalTime?: number; target?: number; brakeTime?: number
}
export interface Pickup { id: number; x: number; z: number; repair: boolean }
export type HazardKind = 'ramp' | 'pad' | 'oil'
export interface Hazard { id: number; kind: HazardKind; x: number; z: number }
export type MissionKind = 'near' | 'drift' | 'speed' | 'clean' | 'air' | 'pickup'
export interface Mission { kind: MissionKind; target: number; progress: number; time: number }
export interface Zone {
  name: string; tagline: string
  traffic: number; trucks: number; grip: number; speed: number; curve: number
  hazards: Record<HazardKind, number>; rain: boolean
}

export const LANES = [-7.5, -2.5, 2.5, 7.5]
export const PLAYER_Z = 4
export const ZONE_LENGTH = 1400
export const DIFFICULTIES = {
  chill: { cruise: 202, damage: 18, interval: 1.8, multiplier: 0.8, clock: 60 },
  normal: { cruise: 228, damage: 27, interval: 1.25, multiplier: 1, clock: 50 },
  expert: { cruise: 244, damage: 37, interval: 0.86, multiplier: 1.5, clock: 44 },
} as const
export const ZONES: readonly Zone[] = [
  { name: 'Sunset Coast', tagline: 'Warm tyres. Ocean on your left.', traffic: 1, trucks: 0.14, grip: 1, speed: 0, curve: 0.55,
    hazards: { ramp: 0.3, pad: 0.7, oil: 0 }, rain: false },
  { name: 'Neon Downtown', tagline: 'Rush hour never sleeps.', traffic: 1.45, trucks: 0.08, grip: 1, speed: 10, curve: 0.35,
    hazards: { ramp: 0.25, pad: 0.5, oil: 0.25 }, rain: false },
  { name: 'Red Canyon', tagline: 'Big rigs. Bigger jumps.', traffic: 1.1, trucks: 0.4, grip: 0.9, speed: 18, curve: 1,
    hazards: { ramp: 0.6, pad: 0.25, oil: 0.15 }, rain: false },
  { name: 'Storm Causeway', tagline: 'Wet asphalt. Low grip. No mercy.', traffic: 1.3, trucks: 0.2, grip: 0.6, speed: 24, curve: 0.75,
    hazards: { ramp: 0.15, pad: 0.35, oil: 0.5 }, rain: true },
]
export const MISSIONS: Record<MissionKind, { target: number; time: number }> = {
  near: { target: 4, time: 18 },
  drift: { target: 3, time: 16 },
  speed: { target: 3, time: 16 },
  clean: { target: 15, time: 16 },
  air: { target: 1, time: 20 },
  pickup: { target: 2, time: 22 },
}
const GEARS = [0, 55, 100, 145, 190, 240, 400]

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const smooth = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x) }

export function zoneAt(distance: number) {
  return ZONES[Math.floor(Math.max(0, distance) / ZONE_LENGTH) % ZONES.length]
}

/** Signed curvature (-1..1, positive bends right). The first stretch is straight. */
export function roadCurve(distance: number) {
  const d = Math.max(0, distance)
  const index = Math.floor(d / ZONE_LENGTH)
  const current = ZONES[index % ZONES.length].curve
  const previous = index === 0 ? current : ZONES[(index - 1) % ZONES.length].curve
  const amplitude = previous + (current - previous) * smooth((d % ZONE_LENGTH) / 250)
  return smooth((d - 350) / 400) * amplitude * (Math.sin(d / 310) * 0.7 + Math.sin(d / 127 + 1.7) * 0.3)
}

/** Visual-only elevation (-1..1). */
export function roadHill(distance: number) {
  const d = Math.max(0, distance)
  return smooth((d - 200) / 400) * (Math.sin(d / 230 + 0.4) * 0.65 + Math.sin(d / 97) * 0.35)
}

export function gearbox(speed: number) {
  let gear = 1
  while (gear < GEARS.length - 1 && speed >= GEARS[gear]) gear++
  return { gear, rev: clamp((speed - GEARS[gear - 1]) / (GEARS[gear] - GEARS[gear - 1]), 0, 1) }
}

export class Race {
  mode: Mode
  difficulty: Difficulty
  time = 0
  timeLeft = 0
  distance = 0
  score = 0
  speed = 0
  topSpeed = 0
  x = 0
  lateralSpeed = 0
  health = 100
  nitro = 100
  combo = 1
  comboTime = 0
  nearMisses = 0
  boosting = false
  drifting = false
  drafting = false
  invulnerable = 0
  finished = false
  completed = false
  zoneIndex = 0
  checkpoints = 0
  lastBonus = 0
  curve = 0
  air = 0
  airDuration = 0
  spin = 0
  surge = 0
  jumps = 0
  vaults = 0
  missionsDone = 0
  mission: Mission | null = null
  traffic: Traffic[] = []
  pickups: Pickup[] = []
  hazards: Hazard[] = []
  private random: () => number
  private nextId = 1
  private spawnIn = 1.5
  private pickupIn = 1.8
  private hazardIn = 6
  private missionIn = 9
  private forceRamp = false
  private lastMission: MissionKind | null = null
  private edgeIn = 0
  private boostLocked = false

  constructor(mode: Mode, difficulty: Difficulty, random = Math.random) {
    this.mode = mode
    this.difficulty = difficulty
    this.random = random
    this.timeLeft = mode === 'sprint' ? DIFFICULTIES[difficulty].clock : 0
    for (let i = 0; i < 5; i++) this.spawnTraffic(-105 - i * 42)
    this.pickups.push({ id: this.nextId++, x: 0, z: -55, repair: false })
  }

  get zone() { return ZONES[this.zoneIndex % ZONES.length] }
  get lap() { return Math.floor(this.zoneIndex / ZONES.length) }
  get heat() { return 1 + this.lap * 0.2 }
  get height() { return this.air > 0 ? 4.2 * Math.sin(Math.PI * (1 - this.air / this.airDuration)) : 0 }
  get nextCheckpoint() { return (this.zoneIndex + 1) * ZONE_LENGTH - this.distance }

  private laneOf(car: Traffic) { return car.lane ?? car.x }

  private spawnTraffic(z = -245) {
    // No four-car walls: reserve a full free lane in every nearby traffic group.
    const occupied = this.traffic.filter(car => Math.abs(car.z - z) < 22)
    const available = LANES.filter(x => !occupied.some(car => this.laneOf(car) === x || car.target === x))
    if (available.length <= 1) return
    const lane = available[Math.floor(this.random() * available.length)]
    this.traffic.push({
      id: this.nextId++, x: lane, z, lane, phase: this.random() * Math.PI * 2,
      speed: 18 + this.random() * 13, color: Math.floor(this.random() * 6),
      truck: this.random() < this.zone.trucks, passed: false,
    })
  }

  private planLaneChange(car: Traffic) {
    const lane = car.lane!
    const index = LANES.indexOf(lane)
    const options = [LANES[index - 1], LANES[index + 1]].filter((x): x is number => x !== undefined)
    const target = options[Math.floor(this.random() * options.length)]
    const group = this.traffic.filter(other => other !== car && Math.abs(other.z - car.z) < 22)
    const used = new Set([lane, target])
    for (const other of group) {
      used.add(this.laneOf(other))
      if (other.target !== undefined) used.add(other.target)
    }
    // A changing car occupies two lanes, so it must still leave one open.
    if (group.some(other => this.laneOf(other) === target || other.target === target) || used.size >= LANES.length) return
    car.signal = target > lane ? 1 : -1
    car.signalTime = 1.3
    car.target = target
  }

  private spawnHazard() {
    const weights = this.zone.hazards
    let kind: HazardKind = 'ramp'
    if (!this.forceRamp) {
      let roll = this.random() * (weights.ramp + weights.pad + weights.oil)
      for (const option of ['ramp', 'pad', 'oil'] as const) {
        kind = option
        if ((roll -= weights[option]) < 0) break
      }
    }
    const z = -235
    const clear = LANES.filter(x =>
      !this.traffic.some(car => (this.laneOf(car) === x || car.target === x) && car.z > z - 12 && car.z < PLAYER_Z + 8)
      && !this.pickups.some(pickup => pickup.x === x && Math.abs(pickup.z - z) < 20)
      && !this.hazards.some(hazard => hazard.x === x && Math.abs(hazard.z - z) < 30))
    // Oil is never allowed to take the last traffic-free lane.
    if (clear.length < (kind === 'oil' ? 2 : 1)) { this.hazardIn = 0.5; return }
    this.hazards.push({ id: this.nextId++, kind, x: clear[Math.floor(this.random() * clear.length)], z })
    if (kind === 'ramp') this.forceRamp = false
    this.hazardIn = (2.4 + this.random() * 2.6) / Math.sqrt(this.zone.traffic)
  }

  private progress(kind: MissionKind, amount = 1) {
    if (this.mission?.kind === kind) this.mission.progress += amount
  }

  private startMission(events: RaceEvent[]) {
    const kinds = (Object.keys(MISSIONS) as MissionKind[]).filter(kind => kind !== this.lastMission)
    const kind = kinds[Math.floor(this.random() * kinds.length)]
    this.lastMission = kind
    this.mission = { kind, target: MISSIONS[kind].target + (kind === 'near' ? this.lap : 0), progress: 0, time: MISSIONS[kind].time }
    if (kind === 'air') { this.forceRamp = true; this.hazardIn = Math.min(this.hazardIn, 1) }
    events.push('mission-start')
  }

  step(dt: number, input: Controls): RaceEvent[] {
    if (this.finished || dt <= 0 || !Number.isFinite(dt)) return []
    // A suspended tab must never teleport the car through traffic.
    dt = Math.min(dt, 0.05)
    const events: RaceEvent[] = []
    const tuning = DIFFICULTIES[this.difficulty]
    const zone = this.zone
    const airborne = this.air > 0
    let crashed = false
    this.time += dt
    if (this.mode === 'sprint') this.timeLeft = Math.max(0, this.timeLeft - dt)
    this.invulnerable = Math.max(0, this.invulnerable - dt)
    this.edgeIn = Math.max(0, this.edgeIn - dt)
    this.comboTime = Math.max(0, this.comboTime - dt)
    this.spin = Math.max(0, this.spin - dt)
    this.surge = Math.max(0, this.surge - dt)
    if (!this.comboTime) this.combo = 1
    if (!input.boost || this.nitro >= 20) this.boostLocked = false
    this.boosting = input.boost && !input.brake && this.nitro > 0.5 && !this.boostLocked
    this.drifting = input.drift && Math.abs(input.steer) > 0.1 && this.speed > 95 && !airborne && !this.spin
    this.drafting = !airborne && this.speed > 120 && this.traffic.some(car =>
      car.z < PLAYER_Z - 6 && car.z > PLAYER_Z - 28 && Math.abs(car.x - this.x) < 1.4)
    let target = input.brake ? 72 : this.boosting ? 322 : tuning.cruise + zone.speed + this.lap * 12
    if (!input.brake && (this.surge || this.drafting)) target = Math.max(target, this.surge ? 330 : target + 18)
    const acceleration = this.boosting || this.surge ? 100 : 48
    if (!airborne) this.speed += clamp(target - this.speed, -125 * dt, acceleration * dt)
    const steering = clamp(input.steer, -1, 1)
    if (this.spin) {
      const wobble = Math.sin(this.spin * 17) * 9
      this.lateralSpeed += (wobble - this.lateralSpeed) * (1 - Math.exp(-dt * 6))
    } else if (!airborne) {
      const lateralTarget = steering * (this.drifting ? 15 : 10) * clamp(this.speed / 90, 0.3, 1)
      this.lateralSpeed += (lateralTarget - this.lateralSpeed) * (1 - Math.exp(-dt * (this.drifting ? 4.5 : 10) * zone.grip))
    }
    this.curve = roadCurve(this.distance)
    // Centrifugal pull toward the outside of the bend; airborne cars hold their line.
    const pull = airborne ? 0 : -this.curve * 5.5 * clamp(this.speed / 228, 0, 1.4)
    this.x = clamp(this.x + (this.lateralSpeed + pull) * dt, -10.1, 10.1)
    if (!airborne && Math.abs(this.x) > 9.65) {
      this.health = Math.max(0, this.health - 9 * dt)
      this.speed = Math.max(72, this.speed - 100 * dt)
      if (!this.edgeIn) { events.push('edge'); this.edgeIn = 3 }
    }
    const refill = this.boosting ? -29 : (this.drifting ? 18 : 7) + (this.drafting ? 14 : 0)
    this.nitro = clamp(this.nitro + dt * refill, 0, 100)
    if (this.nitro < 0.6 && this.boosting) this.boostLocked = true
    this.topSpeed = Math.max(this.topSpeed, this.speed)
    const advance = this.speed / 3.6 * dt
    this.distance += advance
    this.score += (advance * 0.8 + (this.drifting ? 18 * dt : 0)) * this.combo * tuning.multiplier
    const zoneIndex = Math.floor(this.distance / ZONE_LENGTH)
    if (zoneIndex > this.zoneIndex) {
      this.zoneIndex = zoneIndex
      this.checkpoints++
      this.score += 750 * zoneIndex * tuning.multiplier
      this.lastBonus = this.mode === 'sprint' ? Math.max(10, 26 - this.checkpoints * 2) : 0
      this.timeLeft += this.lastBonus
      events.push('zone')
    }
    this.spawnIn -= dt
    this.pickupIn -= dt
    this.hazardIn -= dt
    if (this.spawnIn <= 0) {
      this.spawnTraffic()
      this.spawnIn = Math.max(0.58, tuning.interval - this.time / 260) / (zone.traffic * this.heat) * (0.85 + this.random() * 0.3)
    }
    if (this.pickupIn <= 0) {
      const x = LANES[Math.floor(this.random() * LANES.length)]
      if (!this.traffic.some(car => car.x === x && Math.abs(car.z + 205) < 18)) {
        this.pickups.push({ id: this.nextId++, x, z: -205, repair: this.random() < 0.22 })
      }
      this.pickupIn = 2.7 + this.random() * 1.2
    }
    if (this.hazardIn <= 0) this.spawnHazard()
    for (const car of this.traffic) {
      const previousZ = car.z
      if (car.brakeTime) car.brakeTime = Math.max(0, car.brakeTime - dt)
      car.z += advance - (car.brakeTime ? car.speed * 0.4 : car.speed) * dt
      // Gentle, visible lane wander prevents parking on a lane divider forever.
      // The spawn zone stays centered so free-lane guarantees remain predictable.
      if (car.lane !== undefined && car.z > -190) {
        if (car.signal) {
          car.signalTime = (car.signalTime ?? 0) - dt
          if (car.signalTime <= 0) { car.lane = car.target ?? car.lane; car.signal = 0; car.target = undefined }
        } else if (car.z < -30 && !car.truck && this.random() < dt * 0.12 * this.heat * zone.traffic) this.planLaneChange(car)
        if (!car.brakeTime && car.z < -40 && this.random() < dt * 0.03 * this.heat) car.brakeTime = 1.4
        const targetX = car.lane + Math.sin(this.time * 0.65 + (car.phase ?? 0)) * 0.85
        car.x += (targetX - car.x) * (1 - Math.exp(-dt * 1.6))
      }
      const dx = Math.abs(this.x - car.x)
      const collisionLength = car.truck ? 5.1 : 4
      const width = car.truck ? 2.25 : 2.02
      const sweptOverlap = Math.min(previousZ, car.z) < PLAYER_Z + collisionLength && Math.max(previousZ, car.z) > PLAYER_Z - collisionLength
      if (!car.passed && sweptOverlap && dx < width && !airborne && this.invulnerable === 0) {
        this.health = Math.max(0, this.health - tuning.damage)
        this.speed *= 0.58
        this.combo = 1
        this.comboTime = 0
        this.invulnerable = 1.7
        this.lateralSpeed = (this.x >= car.x ? 1 : -1) * 6
        car.passed = true
        crashed = true
        events.push('crash')
      }
      if (!car.passed && previousZ <= PLAYER_Z + collisionLength && car.z > PLAYER_Z + collisionLength) {
        car.passed = true
        if (airborne && dx < 3.65) {
          this.vaults++
          this.combo = Math.min(8, this.combo + 1)
          this.comboTime = 6
          this.score += 300 * this.combo * tuning.multiplier
          this.nitro = Math.min(100, this.nitro + 10)
          this.progress('near')
          events.push('vault')
        } else if (!airborne && dx < 3.65 && dx >= width && this.invulnerable === 0) {
          this.combo = Math.min(8, this.combo + 1)
          this.comboTime = 6
          this.nearMisses++
          this.score += (this.boosting ? 350 : 200) * this.combo * tuning.multiplier
          this.nitro = Math.min(100, this.nitro + 10)
          this.progress('near')
          events.push('near')
        }
      }
    }
    this.traffic = this.traffic.filter(car => car.z < 38 && car.z > -330)
    this.pickups = this.pickups.filter(pickup => {
      const previousZ = pickup.z
      pickup.z += advance
      if (previousZ < PLAYER_Z + 2.5 && pickup.z > PLAYER_Z - 2.5 && Math.abs(pickup.x - this.x) < 1.85) {
        if (pickup.repair) this.health = Math.min(100, this.health + 24)
        else this.nitro = Math.min(100, this.nitro + 32)
        this.score += 120 * this.combo * tuning.multiplier
        this.progress('pickup')
        events.push(pickup.repair ? 'repair' : 'pickup')
        return false
      }
      return pickup.z < 30
    })
    this.hazards = this.hazards.filter(hazard => {
      const previousZ = hazard.z
      hazard.z += advance
      const length = hazard.kind === 'ramp' ? 3.2 : 2.5
      if (airborne || previousZ >= PLAYER_Z + length || hazard.z <= PLAYER_Z - length || Math.abs(hazard.x - this.x) >= 1.95) return hazard.z < 30
      if (hazard.kind === 'ramp') {
        this.air = this.airDuration = clamp(0.55 + this.speed / 300, 0.85, 1.65)
        this.drifting = false
        events.push('jump')
      } else if (hazard.kind === 'pad') {
        this.surge = 1.4
        this.speed = Math.max(this.speed, 280)
        this.nitro = Math.min(100, this.nitro + 12)
        this.score += 150 * this.combo * tuning.multiplier
        events.push('pad')
      } else {
        if (this.invulnerable) return hazard.z < 30
        this.spin = 1.1
        this.combo = 1
        this.comboTime = 0
        events.push('oil')
      }
      return false
    })
    if (airborne) {
      this.air = Math.max(0, this.air - dt)
      if (!this.air) {
        this.jumps++
        this.combo = Math.min(8, this.combo + 1)
        this.comboTime = 6
        this.score += 400 * this.combo * tuning.multiplier
        this.progress('air')
        events.push('land')
      }
    }
    const mission = this.mission
    if (mission) {
      mission.time = Math.max(0, mission.time - dt)
      if ((mission.kind === 'drift' && this.drifting) || (mission.kind === 'speed' && this.speed >= 285) || mission.kind === 'clean') mission.progress += dt
      if (mission.kind === 'clean' && crashed) mission.time = 0
      if (mission.progress >= mission.target) {
        this.missionsDone++
        this.score += 1500 * tuning.multiplier * (1 + this.lap * 0.5)
        this.nitro = 100
        if (this.mode === 'sprint') this.timeLeft += 5
        this.mission = null
        this.missionIn = 8
        events.push('mission-complete')
      } else if (!mission.time) {
        this.mission = null
        this.missionIn = 8
        events.push('mission-fail')
      }
    } else if ((this.missionIn -= dt) <= 0) this.startMission(events)
    if (this.health <= 0 || (this.mode === 'sprint' && this.timeLeft <= 1e-9)) {
      this.finished = true
      this.completed = this.health > 0
      this.boosting = false
      if (this.completed) this.score += Math.round(this.health * 25 * tuning.multiplier)
      events.push('finish')
    }
    return events
  }
}
