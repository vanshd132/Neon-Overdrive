# Neon Overdrive

A neon-soaked, sunset-highway 3D arcade racer built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) + TypeScript. Dodge traffic, drift through close calls, grab boost cells, and chase a high score in a 90-second sprint or endless mode.

## About this project

This project was made to test the capability of **GPT-6 Astra** in **one shot**. The only prompt given was:

> i m very bored and need some fun game to play , mayb e3d maybe 2d as u like , but fun and more of action or maybe car racinga nd ery well defined , lets go

Everything — game design, 3D scene, physics/collision, audio, UI, and controls — was generated from that single prompt.

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

- Arrow keys / WASD – steer, accelerate, brake
- Space / Shift – nitro boost
- Touch controls available on mobile
