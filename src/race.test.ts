import { expect, test, describe } from 'vitest'
import { DIFFICULTIES, LANES, PLAYER_Z, Race, ZONE_LENGTH, gearbox, roadCurve } from './race'
import type { Controls, Difficulty, Mode, RaceEvent, Traffic } from './race'

const STEP = 0.05
const IDLE: Controls = { steer: 0, brake: false, boost: false, drift: false }
const BOOST: Controls = { ...IDLE, boost: true }
const DIFFICULTY_NAMES: Difficulty[] = ['chill', 'normal', 'expert']

// Local deterministic RNG: no global Math.random mocking or shared mutable seed.
function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function emptyRace(mode: Mode = 'endless', difficulty: Difficulty = 'normal') {
  const race = new Race(mode, difficulty, seededRandom(12345))
  race.traffic = []
  race.pickups = []
  return race
}

function car(overrides: Partial<Traffic> = {}): Traffic {
  return {
    id: -1, x: 0, z: PLAYER_Z, speed: 0, color: 0, truck: false, passed: false,
    ...overrides,
  }
}

// For isolated movement/timer tests only. Staged interactions and population
// tests call step directly so their traffic and pickups are never discarded.
function clearStep(race: Race, input: Controls = IDLE) {
  race.traffic = []
  race.pickups = []
  return race.step(STEP, input)
}

function advanceClear(race: Race, steps: number, input: Controls = IDLE) {
  const events: RaceEvent[] = []
  for (let i = 0; i < steps; i++) events.push(...clearStep(race, input))
  return events
}

function stageNearMiss(race: Race, truck = false) {
  race.x = 0
  race.lateralSpeed = 0
  race.speed = 180
  const traffic = car({ x: 2.5, z: PLAYER_Z + (truck ? 5.1 : 4) - 0.1, truck })
  race.traffic = [traffic]
  race.pickups = []
  return traffic
}

// Copy public state, including entity contents, rather than retaining mutable
// references or reaching into private RNG, spawn timers, or boost-lock fields.
function snapshot(race: Race) {
  return {
    mode: race.mode,
    difficulty: race.difficulty,
    time: race.time,
    distance: race.distance,
    score: race.score,
    speed: race.speed,
    topSpeed: race.topSpeed,
    x: race.x,
    lateralSpeed: race.lateralSpeed,
    health: race.health,
    nitro: race.nitro,
    combo: race.combo,
    comboTime: race.comboTime,
    nearMisses: race.nearMisses,
    boosting: race.boosting,
    drifting: race.drifting,
    invulnerable: race.invulnerable,
    finished: race.finished,
    completed: race.completed,
    traffic: race.traffic.map(traffic => ({ ...traffic })),
    pickups: race.pickups.map(pickup => ({ ...pickup })),
  }
}

describe('seeded simulation', () => {
  test('identical seeds and inputs reproduce initial state, spawns, events, and movement', () => {
    const first = new Race('endless', 'expert', seededRandom(42))
    const second = new Race('endless', 'expert', seededRandom(42))
    expect(snapshot(first)).toEqual(snapshot(second))
    // Wandering traffic crosses x=0, so give both runs enough health to last.
    first.health = second.health = 10_000

    for (let i = 0; i < 600; i++) {
      // Staying between the middle lanes avoids incidental collisions even
      // with trucks, while speed changes exercise later spawn decisions.
      const input = { ...IDLE, boost: i % 160 < 40, brake: i % 160 >= 120 }
      expect(first.step(STEP, input)).toEqual(second.step(STEP, input))
    }

    expect(snapshot(first)).toEqual(snapshot(second))
    expect(first.time).toBeCloseTo(30, 8)
    expect(first.finished).toBe(false)
  })

  test('different seeds produce different initial traffic', () => {
    const first = new Race('endless', 'normal', seededRandom(42))
    const second = new Race('endless', 'normal', seededRandom(43))
    expect(first.traffic).toHaveLength(5)
    expect(second.traffic).toHaveLength(5)
    expect(first.traffic).not.toEqual(second.traffic)
  })
})

describe('acceleration, steering, and braking', () => {
  test.each(DIFFICULTY_NAMES)('accelerates to the %s cruise speed without overshooting', difficulty => {
    const race = emptyRace('endless', difficulty)
    const tuning = DIFFICULTIES[difficulty]

    clearStep(race)
    expect(race.speed).toBeCloseTo(48 * STEP)
    expect(race.distance).toBeCloseTo(race.speed / 3.6 * STEP)
    expect(race.score).toBeCloseTo(race.distance * 0.8 * tuning.multiplier)

    advanceClear(race, 119)
    expect(race.speed).toBe(tuning.cruise)
    expect(race.topSpeed).toBe(tuning.cruise)
    advanceClear(race, 20)
    expect(race.speed).toBe(tuning.cruise)
    expect(race.health).toBe(100)
  })

  test('boost accelerates faster and caps speed at 322', () => {
    const race = emptyRace()
    clearStep(race, BOOST)
    expect(race.speed).toBe(100 * STEP)
    expect(race.boosting).toBe(true)

    advanceClear(race, 64, BOOST)
    expect(race.speed).toBe(322)
    expect(race.topSpeed).toBe(322)
    expect(race.nitro).toBeCloseTo(100 - 65 * STEP * 29)
  })

  test.each([-1, 1])('clamps steering input and road position in direction %s', direction => {
    const normal = emptyRace()
    const excessive = emptyRace()
    normal.speed = excessive.speed = 228

    clearStep(normal, { ...IDLE, steer: direction })
    clearStep(excessive, { ...IDLE, steer: direction * 100 })
    expect(normal.lateralSpeed).toBeCloseTo(direction * 10 * (1 - Math.exp(-10 * STEP)))
    expect(Math.sign(normal.x)).toBe(direction)
    expect(snapshot(excessive)).toEqual(snapshot(normal))

    advanceClear(normal, 49, { ...IDLE, steer: direction })
    advanceClear(excessive, 49, { ...IDLE, steer: direction * 100 })
    expect(normal.x).toBe(direction * 10.1)
    expect(snapshot(excessive)).toEqual(snapshot(normal))
    expect(normal.health).toBeGreaterThan(0)
  })

  test('steering is weaker at low speed and lateral motion decays after release', () => {
    const slow = emptyRace()
    const fast = emptyRace()
    fast.speed = 180
    clearStep(slow, { ...IDLE, steer: 1 })
    clearStep(fast, { ...IDLE, steer: 1 })

    expect(slow.lateralSpeed).toBeCloseTo(3 * (1 - Math.exp(-10 * STEP)))
    expect(fast.lateralSpeed).toBeGreaterThan(slow.lateralSpeed)
    const previous = fast.lateralSpeed
    advanceClear(fast, 10)
    expect(fast.lateralSpeed).toBeCloseTo(previous * Math.exp(-10 * STEP * 10))
    expect(fast.lateralSpeed).toBeGreaterThan(0)
  })

  test('braking overrides boost, decelerates at 125 per second, and settles at 72', () => {
    const race = emptyRace()
    race.speed = 228
    race.nitro = 50
    const input = { ...BOOST, brake: true }

    clearStep(race, input)
    expect(race.speed).toBeCloseTo(228 - 125 * STEP)
    expect(race.boosting).toBe(false)
    expect(race.nitro).toBeCloseTo(50 + 7 * STEP)

    advanceClear(race, 29, input)
    expect(race.speed).toBe(72)
    expect(race.topSpeed).toBeCloseTo(228 - 125 * STEP)
  })

  test('road-edge contact damages health and throttles the edge event', () => {
    const race = emptyRace()
    race.x = 10.1
    race.speed = 228
    const input = { ...IDLE, steer: 1 }

    expect(clearStep(race, input)).toEqual(['edge'])
    expect(race.health).toBeCloseTo(100 - 9 * STEP)
    expect(race.speed).toBeCloseTo(228 - 100 * STEP)
    expect(advanceClear(race, 19, input)).not.toContain('edge')
    expect(race.health).toBeCloseTo(91)
  })
})

describe('nitro and drifting', () => {
  test('boost consumes 29 nitro per second', () => {
    const race = emptyRace()
    race.nitro = 50
    advanceClear(race, 20, BOOST)
    expect(race.nitro).toBeCloseTo(21)
    expect(race.boosting).toBe(true)
  })

  test('idle refill restores 7 per second and never exceeds 100', () => {
    const race = emptyRace()
    race.nitro = 20
    advanceClear(race, 20)
    expect(race.nitro).toBeCloseTo(27)
    race.nitro = 99.9
    advanceClear(race, 20)
    expect(race.nitro).toBe(100)
  })

  test('drifting refills 18 per second, changes steering response, and awards drift score', () => {
    const race = emptyRace()
    race.speed = 150
    race.nitro = 40
    clearStep(race, { ...IDLE, steer: 0.5, drift: true })

    expect(race.drifting).toBe(true)
    expect(race.nitro).toBeCloseTo(40 + 18 * STEP)
    expect(race.lateralSpeed).toBeCloseTo(7.5 * (1 - Math.exp(-4.5 * STEP)))
    expect(race.score).toBeCloseTo(race.distance * 0.8 + 18 * STEP)
  })

  test.each([
    { speed: 95, steer: 0.5 },
    { speed: 150, steer: 0.1 },
  ])('does not drift at the speed/steering threshold: $speed / $steer', ({ speed, steer }) => {
    const race = emptyRace()
    race.speed = speed
    race.nitro = 40
    clearStep(race, { ...IDLE, steer, drift: true })
    expect(race.drifting).toBe(false)
    expect(race.nitro).toBeCloseTo(40 + 7 * STEP)
  })

  test('empty nitro locks held boost until refill reaches 20 without rapid retriggering', () => {
    const race = emptyRace()
    race.nitro = 1
    clearStep(race, BOOST)
    expect(race.nitro).toBe(0)

    for (let i = 0; i < 58; i++) {
      clearStep(race, BOOST)
      expect(race.boosting).toBe(false)
      expect(race.nitro).toBeCloseTo((i + 1) * 7 * STEP)
    }
    expect(race.nitro).toBeCloseTo(20.3)

    clearStep(race, BOOST)
    expect(race.boosting).toBe(true)
    expect(race.nitro).toBeCloseTo(20.3 - 29 * STEP)
  })

  test('releasing boost clears the lock so it can restart below 20 nitro', () => {
    const race = emptyRace()
    race.nitro = 1
    clearStep(race, BOOST)
    advanceClear(race, 2)
    expect(race.nitro).toBeCloseTo(0.7)
    expect(race.boosting).toBe(false)

    clearStep(race, BOOST)
    expect(race.boosting).toBe(true)
    expect(race.nitro).toBe(0)
  })

  test.each([0, 0.5])('cannot start boosting with only %s nitro', nitro => {
    const race = emptyRace()
    race.nitro = nitro
    clearStep(race, BOOST)
    expect(race.boosting).toBe(false)
    expect(race.speed).toBeCloseTo(48 * STEP)
    expect(race.nitro).toBeCloseTo(nitro + 7 * STEP)
  })
})

describe('near misses and combos', () => {
  test.each([false, true])('counts a passing vehicle only once (truck=%s)', truck => {
    const race = emptyRace()
    race.nitro = 40
    const passing = stageNearMiss(race, truck)

    expect(race.step(STEP, IDLE)).toEqual(['near'])
    expect(passing.passed).toBe(true)
    expect(race.nearMisses).toBe(1)
    expect(race.combo).toBe(2)
    expect(race.comboTime).toBe(6)
    expect(race.health).toBe(100)
    expect(race.nitro).toBeCloseTo(40 + 7 * STEP + 10)
    expect(race.score).toBeCloseTo(race.distance * 0.8 + 200 * 2)

    const score = race.score
    const distance = race.distance
    for (let i = 0; i < 5; i++) expect(race.step(STEP, IDLE)).not.toContain('near')
    expect(race.traffic).toContain(passing)
    expect(race.nearMisses).toBe(1)
    expect(race.combo).toBe(2)
    expect(race.score - score).toBeCloseTo((race.distance - distance) * 0.8 * 2)
  })

  test('chains near misses, refreshes the combo timer, and caps combo and nitro', () => {
    const race = emptyRace()
    race.nitro = 95

    for (let i = 0; i < 10; i++) {
      stageNearMiss(race)
      const oldCombo = race.combo
      const oldScore = race.score
      const oldDistance = race.distance
      expect(race.step(STEP, IDLE)).toEqual(['near'])
      expect(race.combo).toBe(Math.min(8, i + 2))
      expect(race.comboTime).toBe(6)
      expect(race.nitro).toBe(100)
      expect(race.score - oldScore).toBeCloseTo(
        (race.distance - oldDistance) * 0.8 * oldCombo + 200 * race.combo,
      )
    }
    expect(race.nearMisses).toBe(10)
  })

  test('boosted near misses use the larger bonus and difficulty multiplier', () => {
    const race = emptyRace('endless', 'expert')
    stageNearMiss(race)
    expect(race.step(STEP, BOOST)).toEqual(['near'])
    expect(race.boosting).toBe(true)
    expect(race.score).toBeCloseTo((race.distance * 0.8 + 350 * 2) * 1.5)
  })

  test('combo expires before scoring the step on which its timer reaches zero', () => {
    const race = emptyRace()
    race.speed = 180
    race.combo = 4
    race.comboTime = 2 * STEP

    clearStep(race)
    expect(race.combo).toBe(4)
    expect(race.comboTime).toBeCloseTo(STEP)
    const score = race.score
    const distance = race.distance

    clearStep(race)
    expect(race.comboTime).toBe(0)
    expect(race.combo).toBe(1)
    expect(race.score - score).toBeCloseTo((race.distance - distance) * 0.8)
    advanceClear(race, 5)
    expect(race.comboTime).toBe(0)
  })

  test('a distant pass is marked passed without a near-miss reward', () => {
    const race = emptyRace()
    const passing = stageNearMiss(race)
    passing.x = 3.65
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(passing.passed).toBe(true)
    expect(race.nearMisses).toBe(0)
    expect(race.combo).toBe(1)
    expect(race.score).toBeCloseTo(race.distance * 0.8)
  })

  test('invulnerability suppresses near-miss rewards and prevents counting the pass later', () => {
    const race = emptyRace()
    const passing = stageNearMiss(race)
    race.invulnerable = 2 * STEP
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(passing.passed).toBe(true)
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(race.invulnerable).toBe(0)
    expect(race.nearMisses).toBe(0)
    expect(race.combo).toBe(1)
  })
})

describe('collisions', () => {
  test.each(DIFFICULTY_NAMES)('ordinary collision applies %s damage and resets the combo', difficulty => {
    const race = emptyRace('endless', difficulty)
    race.speed = 180
    race.combo = 5
    race.comboTime = 6
    const obstacle = car()
    race.traffic = [obstacle]

    expect(race.step(STEP, IDLE)).toEqual(['crash'])
    expect(race.health).toBe(100 - DIFFICULTIES[difficulty].damage)
    expect(race.speed).toBeCloseTo((180 + 48 * STEP) * 0.58)
    expect(race.combo).toBe(1)
    expect(race.comboTime).toBe(0)
    expect(race.invulnerable).toBe(1.7)
    expect(obstacle.passed).toBe(true)
    expect(race.lateralSpeed).toBe(6)
  })

  test('multiple overlapping cars cause only one damage event in a step', () => {
    const race = emptyRace()
    race.traffic = [car({ id: -1 }), car({ id: -2 })]
    expect(race.step(STEP, IDLE)).toEqual(['crash'])
    expect(race.health).toBe(73)
  })

  test('invulnerability blocks another collision until its timer expires', () => {
    const race = emptyRace()
    race.speed = 180
    race.traffic = [car()]
    race.step(STEP, IDLE)
    race.lateralSpeed = 0
    race.traffic = [car({ id: -2 })]

    expect(race.step(STEP, IDLE)).not.toContain('crash')
    expect(race.health).toBe(73)
    expect(race.invulnerable).toBeCloseTo(1.7 - STEP)
    advanceClear(race, 34)
    expect(race.invulnerable).toBe(0)

    race.traffic = [car({ id: -3, x: race.x })]
    expect(race.step(STEP, IDLE)).toEqual(['crash'])
    expect(race.health).toBe(46)
  })

  test.each([
    { dimension: 'width', x: 2.1, z: PLAYER_Z },
    { dimension: 'length', x: 0, z: PLAYER_Z + 4.5 },
  ])('trucks have a larger collision $dimension than ordinary cars', ({ x, z }) => {
    const ordinary = emptyRace()
    const truck = emptyRace()
    ordinary.traffic = [car({ x, z })]
    truck.traffic = [car({ x, z, truck: true })]

    expect(ordinary.step(STEP, IDLE)).toEqual([])
    expect(truck.step(STEP, IDLE)).toEqual(['crash'])
    expect(ordinary.health).toBe(100)
    expect(truck.health).toBe(73)
  })
})

describe('pickups and repairs', () => {
  test('nitro pickup restores 32 nitro in addition to passive refill and is consumed once', () => {
    const race = emptyRace()
    race.nitro = 20
    race.pickups = [{ id: -1, x: 0, z: PLAYER_Z, repair: false }]
    expect(race.step(STEP, IDLE)).toEqual(['pickup'])
    expect(race.nitro).toBeCloseTo(20 + 7 * STEP + 32)
    expect(race.pickups).toHaveLength(0)
    expect(race.score).toBeCloseTo(race.distance * 0.8 + 120)
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(race.nitro).toBeCloseTo(20 + 7 * STEP * 2 + 32)
  })

  test('repair restores 24 health and awards the combo-scaled pickup score once', () => {
    const race = emptyRace()
    race.health = 40
    race.nitro = 20
    race.combo = 3
    race.comboTime = 6
    race.pickups = [{ id: -1, x: 0, z: PLAYER_Z, repair: true }]
    expect(race.step(STEP, IDLE)).toEqual(['repair'])
    expect(race.health).toBe(64)
    expect(race.nitro).toBeCloseTo(20 + 7 * STEP)
    expect(race.pickups).toHaveLength(0)
    expect(race.score).toBeCloseTo((race.distance * 0.8 + 120) * 3)
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(race.health).toBe(64)
  })

  test.each([false, true])('pickup cannot raise health or nitro above 100 (repair=%s)', repair => {
    const race = emptyRace()
    race.health = 90
    race.nitro = 95
    race.pickups = [{ id: -1, x: 0, z: PLAYER_Z, repair }]

    expect(race.step(STEP, IDLE)).toEqual([repair ? 'repair' : 'pickup'])
    expect(race.health).toBe(repair ? 100 : 90)
    expect(race.nitro).toBeCloseTo(repair ? 95 + 7 * STEP : 100)
    expect(race.pickups).toHaveLength(0)
  })

  test('a pickup outside lateral collection range gives no reward and is eventually removed', () => {
    const race = emptyRace()
    race.speed = 180
    race.nitro = 20
    race.pickups = [{ id: -1, x: 3, z: PLAYER_Z, repair: false }]
    expect(race.step(STEP, IDLE)).toEqual([])
    expect(race.pickups).toHaveLength(1)
    for (let i = 0; i < 19; i++) expect(race.step(STEP, IDLE)).toEqual([])
    expect(race.pickups).toHaveLength(0)
    expect(race.nitro).toBeCloseTo(27)
    expect(race.score).toBeCloseTo(race.distance * 0.8)
  })
})

describe('race completion', () => {
  test.each(DIFFICULTY_NAMES)('sprint clock starts at the %s allowance and only counts down in sprint', difficulty => {
    const sprint = emptyRace('sprint', difficulty)
    const endless = emptyRace('endless', difficulty)
    expect(sprint.timeLeft).toBe(DIFFICULTIES[difficulty].clock)
    clearStep(sprint)
    clearStep(endless)
    expect(sprint.timeLeft).toBeCloseTo(DIFFICULTIES[difficulty].clock - STEP)
    expect(endless.timeLeft).toBe(0)
    expect(endless.finished).toBe(false)
  })

  test('sprint finishes on the exact step the clock runs out, despite float drift', () => {
    const race = emptyRace('sprint')
    race.timeLeft = 1
    expect(advanceClear(race, 19)).not.toContain('finish')
    expect(race.finished).toBe(false)
    expect(clearStep(race)).toEqual(['finish'])
    expect(race.finished).toBe(true)
    expect(race.completed).toBe(true)
  })

  test('crossing a checkpoint scores the district and extends only the sprint clock', () => {
    const sprint = emptyRace('sprint')
    const endless = emptyRace('endless')
    for (const race of [sprint, endless]) {
      race.distance = ZONE_LENGTH - 1
      race.speed = 228
      race.timeLeft = race.mode === 'sprint' ? 10 : 0
    }
    expect(clearStep(sprint)).toEqual(['zone'])
    expect(clearStep(endless)).toEqual(['zone'])
    expect(sprint.zoneIndex).toBe(1)
    expect(sprint.checkpoints).toBe(1)
    expect(sprint.zone.name).toBe('Neon Downtown')
    expect(sprint.timeLeft).toBeCloseTo(10 - STEP + 24)
    expect(endless.timeLeft).toBe(0)
    expect(sprint.score).toBeCloseTo(228 / 3.6 * STEP * 0.8 + 750)
  })

  test.each(DIFFICULTY_NAMES)('sprint finishes when the clock runs out and pays the %s survival bonus only once', difficulty => {
    const race = emptyRace('sprint', difficulty)
    const multiplier = DIFFICULTIES[difficulty].multiplier
    race.timeLeft = 2 * STEP
    race.speed = DIFFICULTIES[difficulty].cruise
    race.health = 73

    expect(clearStep(race)).toEqual([])
    expect(race.timeLeft).toBeGreaterThan(0)
    expect(race.finished).toBe(false)
    const score = race.score
    const distance = race.distance

    expect(clearStep(race, BOOST)).toEqual(['finish'])
    expect(race.timeLeft).toBe(0)
    expect(race.finished).toBe(true)
    expect(race.completed).toBe(true)
    expect(race.boosting).toBe(false)
    expect(race.score - score).toBeCloseTo(
      (race.distance - distance) * 0.8 * multiplier + Math.round(73 * 25 * multiplier),
    )

    const finished = snapshot(race)
    for (let i = 0; i < 10; i++) {
      expect(race.step(STEP, { ...BOOST, steer: 1 })).toEqual([])
      expect(snapshot(race)).toEqual(finished)
    }
  })

  test('endless continues past 90 seconds without a survival bonus', () => {
    const race = emptyRace()
    race.time = 90 - STEP
    race.health = 73
    race.speed = 228
    expect(advanceClear(race, 41)).not.toContain('finish')
    expect(race.time).toBeCloseTo(92)
    expect(race.finished).toBe(false)
    expect(race.completed).toBe(false)
    expect(race.score).toBeCloseTo(race.distance * 0.8)
  })

  test.each<Mode>(['sprint', 'endless'])('zero health ends %s without completion or survival bonus', mode => {
    const race = emptyRace(mode)
    race.health = 10
    race.speed = 180
    race.traffic = [car()]

    expect(race.step(STEP, IDLE)).toEqual(['crash', 'finish'])
    expect(race.health).toBe(0)
    expect(race.finished).toBe(true)
    expect(race.completed).toBe(false)
    expect(race.score).toBeCloseTo(race.distance * 0.8)

    const finished = snapshot(race)
    expect(race.step(STEP, BOOST)).toEqual([])
    expect(snapshot(race)).toEqual(finished)
  })
})

describe('time-step validation', () => {
  test.each([0, -STEP, NaN, Infinity, -Infinity])('ignores invalid dt %s without mutating state', dt => {
    const race = new Race('endless', 'normal', seededRandom(12))
    race.speed = 180
    race.nitro = 40
    race.combo = 4
    race.comboTime = 2
    race.invulnerable = 1
    race.lateralSpeed = 2
    const before = snapshot(race)
    expect(race.step(dt, { ...BOOST, steer: 1 })).toEqual([])
    expect(snapshot(race)).toEqual(before)
  })

  test.each([0.1, 1, 90])('clamps a dt of %s to a single 0.05-second step', dt => {
    const large = new Race('endless', 'normal', seededRandom(12))
    const fixed = new Race('endless', 'normal', seededRandom(12))
    large.speed = fixed.speed = 180
    const input = { ...BOOST, steer: 0.5 }

    expect(large.step(dt, input)).toEqual(fixed.step(STEP, input))
    expect(snapshot(large)).toEqual(snapshot(fixed))
    expect(large.time).toBe(STEP)
    expect(large.distance).toBeCloseTo((180 + 100 * STEP) / 3.6 * STEP)
  })

  test('preserves positive time steps smaller than the cap', () => {
    const race = emptyRace()
    race.step(STEP / 2, IDLE)
    expect(race.time).toBe(STEP / 2)
    expect(race.speed).toBeCloseTo(48 * STEP / 2)
    expect(race.distance).toBeCloseTo(race.speed / 3.6 * STEP / 2)
  })
})

describe('safe spawning and bounded populations', () => {
  test.each([2, 3])('a natural spawn with %s nearby occupied lanes always leaves a free lane', occupied => {
    const race = emptyRace()
    race.speed = DIFFICULTIES.normal.cruise
    // Match forward speed to hold the staged group near the spawn location.
    // Let the normal spawn timer run; never call or replace the private method.
    race.traffic = LANES.slice(0, occupied).map((x, index) => car({
      id: -index - 1, x, z: -245 + index * 5, speed: race.speed / 3.6,
    }))
    const originalIds = race.traffic.map(traffic => traffic.id)
    for (let i = 0; i < 31; i++) expect(race.step(STEP, IDLE)).toEqual([])

    expect(race.traffic).toHaveLength(3)
    expect(race.traffic.every(traffic => Math.abs(traffic.z + 245) < 22)).toBe(true)
    expect(new Set(race.traffic.map(traffic => traffic.x)).size).toBe(3)
    expect(LANES.filter(x => !race.traffic.some(traffic => traffic.x === x))).toHaveLength(1)
    expect(race.traffic.filter(traffic => !originalIds.includes(traffic.id))).toHaveLength(3 - occupied)
    expect(race.health).toBe(100)
  })

  test.each(DIFFICULTY_NAMES)('traffic and pickups remain bounded during a ten-minute %s race', difficulty => {
    const race = new Race('endless', difficulty, seededRandom(2026))
    let maxTraffic = race.traffic.length
    let maxPickups = race.pickups.length
    let trafficInBounds = true
    let pickupsInBounds = true
    let unexpectedEvent = false
    const trafficIds = new Set(race.traffic.map(traffic => traffic.id))
    const pickupIds = new Set(race.pickups.map(pickup => pickup.id))

    let maxHazards = 0
    // No clearing, teleporting, healing, or private spawn calls. Traffic wanders
    // and changes lanes, so hold invulnerability and steer against curve pull.
    for (let i = 0; i < 12_000; i++) {
      race.invulnerable = 1
      const steer = Math.max(-1, Math.min(1, -(race.x * 0.8 + race.lateralSpeed * 0.15)))
      const events = race.step(STEP, { ...IDLE, steer })
      unexpectedEvent ||= events.includes('crash') || events.includes('finish') || events.includes('edge')
      maxTraffic = Math.max(maxTraffic, race.traffic.length)
      maxPickups = Math.max(maxPickups, race.pickups.length)
      maxHazards = Math.max(maxHazards, race.hazards.length)
      trafficInBounds &&= race.traffic.every(traffic =>
        traffic.z > -330 && traffic.z < 38 && Math.abs(traffic.x) <= 8.5,
      )
      pickupsInBounds &&= race.pickups.every(pickup => pickup.z >= -205 && pickup.z < 30)
      for (const traffic of race.traffic) trafficIds.add(traffic.id)
      for (const pickup of race.pickups) pickupIds.add(pickup.id)
    }

    // Generous bounds allow RNG variation but catch missing expiry/filtering.
    expect(maxTraffic).toBeLessThanOrEqual(32)
    expect(maxPickups).toBeLessThanOrEqual(4)
    expect(maxHazards).toBeLessThanOrEqual(8)
    expect(race.zoneIndex).toBeGreaterThan(4)
    expect(trafficIds.size).toBeGreaterThan(100)
    expect(pickupIds.size).toBeGreaterThan(50)
    expect(trafficInBounds).toBe(true)
    expect(pickupsInBounds).toBe(true)
    expect(unexpectedEvent).toBe(false)
    expect(race.time).toBeCloseTo(600, 7)
    expect(race.finished).toBe(false)
    expect(race.health).toBe(100)
    expect(race.nitro).toBeGreaterThanOrEqual(0)
    expect(race.nitro).toBeLessThanOrEqual(100)
    expect(Number.isFinite(race.score)).toBe(true)
    expect(Number.isFinite(race.distance)).toBe(true)
  })
})

describe('road, hazards, and traffic AI', () => {
  test('the opening stretch is straight and later curves pull the car outward', () => {
    expect(roadCurve(0)).toBe(0)
    expect(roadCurve(340)).toBe(0)
    let bend = 400
    while (Math.abs(roadCurve(bend)) < 0.3) bend += 10
    const race = emptyRace()
    race.speed = 228
    race.distance = bend
    clearStep(race)
    expect(Math.sign(race.x)).toBe(-Math.sign(race.curve))
  })

  test('gearbox maps speed to six gears with a normalised rev fraction', () => {
    expect(gearbox(0)).toEqual({ gear: 1, rev: 0 })
    expect(gearbox(100).gear).toBe(3)
    expect(gearbox(322).gear).toBe(6)
    expect(gearbox(322).rev).toBeGreaterThan(0)
    expect(gearbox(322).rev).toBeLessThan(1)
  })

  test('a ramp launches the car over traffic, then lands for a combo bonus', () => {
    const race = emptyRace()
    race.speed = 228
    race.hazards = [{ id: -1, kind: 'ramp', x: 0, z: PLAYER_Z }]
    expect(race.step(STEP, IDLE)).toEqual(['jump'])
    expect(race.air).toBeGreaterThan(0.85)
    expect(race.hazards).toHaveLength(0)

    race.step(STEP, IDLE)
    expect(race.height).toBeGreaterThan(0)
    const under = car({ z: PLAYER_Z + 3.9 })
    race.traffic = [under]
    expect(race.step(STEP, IDLE)).toEqual(['vault'])
    expect(race.health).toBe(100)
    expect(race.vaults).toBe(1)
    expect(race.combo).toBe(2)

    const events: RaceEvent[] = []
    for (let i = 0; i < 40 && race.air > 0; i++) events.push(...clearStep(race))
    expect(events).toContain('land')
    expect(race.jumps).toBe(1)
    expect(race.combo).toBe(3)
    expect(race.height).toBe(0)
  })

  test('a boost pad surges past cruise speed without using nitro', () => {
    const race = emptyRace()
    race.speed = 200
    race.nitro = 50
    race.hazards = [{ id: -1, kind: 'pad', x: 0, z: PLAYER_Z }]
    expect(race.step(STEP, IDLE)).toEqual(['pad'])
    expect(race.speed).toBe(280)
    expect(race.nitro).toBeCloseTo(50 + 7 * STEP + 12)
    advanceClear(race, 10)
    expect(race.speed).toBeGreaterThan(300)
  })

  test('oil spins the car out, ignores steering, and breaks the combo', () => {
    const race = emptyRace()
    race.speed = 228
    race.combo = 4
    race.comboTime = 6
    race.hazards = [{ id: -1, kind: 'oil', x: 0, z: PLAYER_Z }]
    expect(race.step(STEP, IDLE)).toEqual(['oil'])
    expect(race.spin).toBeGreaterThan(1)
    expect(race.combo).toBe(1)
    const left = emptyRace()
    left.spin = race.spin
    left.speed = 228
    const right = emptyRace()
    right.spin = race.spin
    right.speed = 228
    clearStep(left, { ...IDLE, steer: -1 })
    clearStep(right, { ...IDLE, steer: 1 })
    expect(left.x).toBeCloseTo(right.x)
  })

  test('slipstreaming behind a car adds nitro and pace', () => {
    const race = emptyRace()
    race.speed = 228
    race.nitro = 20
    race.traffic = [car({ z: PLAYER_Z - 15, speed: 228 / 3.6 })]
    race.step(STEP, IDLE)
    expect(race.drafting).toBe(true)
    expect(race.nitro).toBeCloseTo(20 + 21 * STEP)
    expect(race.speed).toBeGreaterThan(228)
  })

  test('braking traffic closes in faster and lane changes are signalled first', () => {
    const cruising = emptyRace()
    const braking = emptyRace()
    for (const race of [cruising, braking]) {
      race.speed = 228
      race.traffic = [car({ z: -100, speed: 25, lane: 2.5, x: 2.5, phase: 0 })]
    }
    braking.traffic[0].brakeTime = 1
    cruising.step(STEP, IDLE)
    braking.step(STEP, IDLE)
    expect(braking.traffic[0].z).toBeGreaterThan(cruising.traffic[0].z)

    const race = new Race('endless', 'expert', seededRandom(7))
    race.health = 10_000
    let signalled = 0
    let changed = 0
    for (let i = 0; i < 4_000; i++) {
      const before = new Map(race.traffic.map(traffic => [traffic.id, traffic.lane]))
      race.step(STEP, IDLE)
      for (const traffic of race.traffic) {
        if (traffic.signal) signalled++
        const lane = before.get(traffic.id)
        if (lane !== undefined && lane !== traffic.lane) changed++
      }
    }
    expect(signalled).toBeGreaterThan(0)
    expect(changed).toBeGreaterThan(0)
  })

  test('hazards never spawn oil into the last traffic-free lane', () => {
    const race = new Race('endless', 'normal', seededRandom(99))
    race.health = 10_000
    race.distance = ZONE_LENGTH * 3
    race.zoneIndex = 3
    for (let i = 0; i < 6_000; i++) {
      const before = new Set(race.hazards.map(hazard => hazard.id))
      race.invulnerable = 1
      race.step(STEP, IDLE)
      for (const hazard of race.hazards) {
        if (before.has(hazard.id) || hazard.kind !== 'oil') continue
        const open = LANES.filter(x => x !== hazard.x && !race.traffic.some(traffic =>
          (traffic.lane ?? traffic.x) === x && traffic.z > hazard.z - 12 && traffic.z < PLAYER_Z + 8))
        expect(open.length).toBeGreaterThan(0)
      }
    }
  })

  test('missions start, track progress, and pay out nitro and sprint time', () => {
    const race = emptyRace('sprint')
    race.timeLeft = 200
    race.speed = 228
    const events = advanceClear(race, 200)
    expect(events).toContain('mission-start')
    expect(race.mission).not.toBeNull()
    race.mission = { kind: 'pickup', target: 1, progress: 0, time: 10 }
    race.nitro = 10
    race.pickups = [{ id: -1, x: race.x, z: PLAYER_Z, repair: false }]
    const timeLeft = race.timeLeft
    const result = race.step(STEP, IDLE)
    expect(result).toEqual(['pickup', 'mission-complete'])
    expect(race.missionsDone).toBe(1)
    expect(race.nitro).toBe(100)
    expect(race.timeLeft).toBeCloseTo(timeLeft - STEP + 5)
    expect(race.mission).toBeNull()
  })

  test('a timed-out mission fails without penalty', () => {
    const race = emptyRace()
    race.mission = { kind: 'drift', target: 3, progress: 0, time: STEP }
    const health = race.health
    expect(clearStep(race)).toEqual(['mission-fail'])
    expect(race.mission).toBeNull()
    expect(race.health).toBe(health)
  })
})