# Neon Overdrive

A neon-soaked 3D arcade highway racer built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) + TypeScript. Race through four districts on curving, rolling roads: dodge traffic that signals and brakes, hit ramps and boost pads, avoid oil, chain missions, and beat the checkpoint clock or survive an endless run.

## About this project

This project was made to test the capability of **GPT-6 Astra** in **one shot**. The only prompt given was:

> i m very bored and need some fun game to play , mayb e3d maybe 2d as u like , but fun and more of action or maybe car racinga nd ery well defined , lets go

The first version — game design, 3D scene, physics/collision, audio, UI, and controls — was generated from that single prompt.

A later follow-up prompt asked for more variety, realism, and challenge. That update added the four districts, road curves, the checkpoint clock, traffic AI, hazards, missions, and weather described below.

## Gameplay

- **Four districts**, each 1.4 km long: Sunset Coast, Neon Downtown, Red Canyon, and Storm Causeway. Each has its own scenery, lighting, traffic mix, and grip; rain on the causeway makes the car slide. After all four, the loop repeats with more traffic and higher speeds.
- **Curves and hills.** Bends push the car toward the outside, so you have to steer through them.
- **Checkpoint rush.** You start with a short clock, and each checkpoint gate adds time, less each time.
- **Traffic AI.** Cars flash their indicators before changing lanes and light up their brake lights when they slow down suddenly.
- **Hazards.** Ramps launch you over traffic, boost pads surge your speed, and oil slicks spin you out.
- **Slipstream.** Tailgating a car recharges nitro faster.
- **Missions.** Timed challenges such as close calls, drifting, top speed, or jumps pay out bonus score, full nitro, and extra time.

## Running locally

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

Then open the printed local URL in your browser.

## Scripts

- `npm run dev` – start the Vite dev server
- `npm run build` – type-check and build for production
- `npm run preview` – preview the production build
- `npm run test` – run the test suite (Vitest)

## Controls

Acceleration is automatic.

- A / D or ← / → – steer
- S or ↓ – brake
- Shift – nitro boost
- Space (while steering) – drift, which recharges nitro
- P or Esc – pause · R – restart · M – sound
- Touch controls appear on the road on touch devices
