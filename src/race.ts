/** Pure fixed-step racing rules. Rendering, sound and input live outside this module. */
export type Mode = 'sprint' | 'endless'
export type Difficulty = 'chill' | 'normal' | 'expert'
export type RaceEvent = 'crash' | 'near' | 'pickup' | 'repair' | 'finish' | 'edge'
export interface Controls { steer: number; brake: boolean; boost: boolean; drift: boolean }
export interface Traffic {
  id: number; x: number; z: number; speed: number; color: number; truck: boolean; passed: boolean
  lane?: number; phase?: number
}
export interface Pickup { id: number; x: number; z: number; repair: boolean }

export const LANES = [-7.5, -2.5, 2.5, 7.5]
export const PLAYER_Z = 4
export const DIFFICULTIES = {
  chill: { cruise: 202, damage: 18, interval: 1.8, multiplier: 0.8 },
  normal: { cruise: 228, damage: 27, interval: 1.25, multiplier: 1 },
  expert: { cruise: 244, damage: 37, interval: 0.86, multiplier: 1.5 },
} as const
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export class Race {
  mode: Mode
  difficulty: Difficulty
  time = 0
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
  invulnerable = 0
  finished = false
  completed = false
  traffic: Traffic[] = []
  pickups: Pickup[] = []
  private random: () => number
  private nextId = 1
  private spawnIn = 1.5
  private pickupIn = 1.8
  private edgeIn = 0
  private boostLocked = false

  constructor(mode: Mode, difficulty: Difficulty, random = Math.random) {
    this.mode = mode
    this.difficulty = difficulty
    this.random = random
    for (let i = 0; i < 5; i++) this.spawnTraffic(-105 - i * 42)
    this.pickups.push({ id: this.nextId++, x: 0, z: -55, repair: false })
  }

  private spawnTraffic(z = -245) {
    // No four-car walls: reserve a full free lane in every nearby traffic group.
    const occupied = this.traffic.filter(car => Math.abs(car.z - z) < 22)
    const available = LANES.filter(x => !occupied.some(car => car.x === x))
    if (available.length <= 1) return
    const lane = available[Math.floor(this.random() * available.length)]
    this.traffic.push({
      id: this.nextId++, x: lane, z, lane, phase: this.random() * Math.PI * 2,
      speed: 18 + this.random() * 13, color: Math.floor(this.random() * 6),
      truck: this.random() < 0.18, passed: false,
    })
  }

  step(dt: number, input: Controls): RaceEvent[] {
    if (this.finished || dt <= 0 || !Number.isFinite(dt)) return []
    // A suspended tab must never teleport the car through traffic.
    dt = Math.min(dt, 0.05)
    const events: RaceEvent[] = []
    const tuning = DIFFICULTIES[this.difficulty]
    this.time += dt
    this.invulnerable = Math.max(0, this.invulnerable - dt)
    this.edgeIn = Math.max(0, this.edgeIn - dt)
    this.comboTime = Math.max(0, this.comboTime - dt)
    if (!this.comboTime) this.combo = 1
    if (!input.boost || this.nitro >= 20) this.boostLocked = false
    this.boosting = input.boost && !input.brake && this.nitro > 0.5 && !this.boostLocked
    this.drifting = input.drift && Math.abs(input.steer) > 0.1 && this.speed > 95
    const target = input.brake ? 72 : this.boosting ? 322 : tuning.cruise
    const acceleration = this.boosting ? 100 : 48
    this.speed += clamp(target - this.speed, -125 * dt, acceleration * dt)
    const steering = clamp(input.steer, -1, 1)
    const lateralTarget = steering * (this.drifting ? 15 : 10) * clamp(this.speed / 90, 0.3, 1)
    this.lateralSpeed += (lateralTarget - this.lateralSpeed) * (1 - Math.exp(-dt * (this.drifting ? 4.5 : 10)))
    this.x = clamp(this.x + this.lateralSpeed * dt, -10.1, 10.1)
    if (Math.abs(this.x) > 9.65) {
      this.health = Math.max(0, this.health - 9 * dt)
      this.speed = Math.max(72, this.speed - 100 * dt)
      if (!this.edgeIn) { events.push('edge'); this.edgeIn = 3 }
    }
    this.nitro = clamp(this.nitro + dt * (this.boosting ? -29 : this.drifting ? 18 : 7), 0, 100)
    if (this.nitro < 0.6 && this.boosting) this.boostLocked = true
    this.topSpeed = Math.max(this.topSpeed, this.speed)
    const advance = this.speed / 3.6 * dt
    this.distance += advance
    this.score += (advance * 0.8 + (this.drifting ? 18 * dt : 0)) * this.combo * tuning.multiplier
    this.spawnIn -= dt
    this.pickupIn -= dt
    if (this.spawnIn <= 0) {
      this.spawnTraffic()
      this.spawnIn = Math.max(0.58, tuning.interval - this.time / 260) * (0.85 + this.random() * 0.3)
    }
    if (this.pickupIn <= 0) {
      const x = LANES[Math.floor(this.random() * LANES.length)]
      if (!this.traffic.some(car => car.x === x && Math.abs(car.z + 205) < 18)) {
        this.pickups.push({ id: this.nextId++, x, z: -205, repair: this.random() < 0.22 })
      }
      this.pickupIn = 2.7 + this.random() * 1.2
    }
    for (const car of this.traffic) {
      const previousZ = car.z
      car.z += advance - car.speed * dt
      // Gentle, visible lane wander prevents parking on a lane divider forever.
      // The spawn zone stays centered so free-lane guarantees remain predictable.
      if (car.lane !== undefined && car.z > -190) {
        const targetX = car.lane + Math.sin(this.time * 0.65 + (car.phase ?? 0)) * 0.85
        car.x += (targetX - car.x) * (1 - Math.exp(-dt * 1.6))
      }
      const dx = Math.abs(this.x - car.x)
      const collisionLength = car.truck ? 5.1 : 4
      const sweptOverlap = Math.min(previousZ, car.z) < PLAYER_Z + collisionLength && Math.max(previousZ, car.z) > PLAYER_Z - collisionLength
      if (!car.passed && sweptOverlap && dx < (car.truck ? 2.25 : 2.02) && this.invulnerable === 0) {
        this.health = Math.max(0, this.health - tuning.damage)
        this.speed *= 0.58
        this.combo = 1
        this.comboTime = 0
        this.invulnerable = 1.7
        this.lateralSpeed = (this.x >= car.x ? 1 : -1) * 6
        car.passed = true
        events.push('crash')
      }
      if (!car.passed && previousZ <= PLAYER_Z + collisionLength && car.z > PLAYER_Z + collisionLength) {
        car.passed = true
        if (dx < 3.65 && dx >= (car.truck ? 2.25 : 2.02) && this.invulnerable === 0) {
          this.combo = Math.min(8, this.combo + 1)
          this.comboTime = 6
          this.nearMisses++
          this.score += (this.boosting ? 350 : 200) * this.combo * tuning.multiplier
          this.nitro = Math.min(100, this.nitro + 10)
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
        events.push(pickup.repair ? 'repair' : 'pickup')
        return false
      }
      return pickup.z < 30
    })
    if (this.health <= 0 || (this.mode === 'sprint' && this.time >= 90 - 1e-9)) {
      this.finished = true
      this.completed = this.health > 0
      this.boosting = false
      if (this.completed) this.score += Math.round(this.health * 25 * tuning.multiplier)
      events.push('finish')
    }
    return events
  }
}