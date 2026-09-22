type EffectKind = 'countdown' | 'go' | 'pickup' | 'near' | 'crash' | 'finish';
type VoiceBus = 'music' | 'effect';

interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  engine: GainNode;
  music: GainNode;
  effects: GainNode;
  filter: BiquadFilterNode;
  carrier: OscillatorNode;
  sub: OscillatorNode;
  subGain: GainNode;
}

interface Voice {
  oscillator: OscillatorNode;
  envelope: GainNode;
  bus: VoiceBus;
  releasing: boolean;
}

const STEP_SECONDS = 60 / 108 / 4;
const LOOK_AHEAD = 0.085;
const MAX_VOICES = 24;
const BASS = [45, 45, 48, 48, 43, 43, 40, 43] as const;
const MELODY = [69, 0, 76, 72, 0, 79, 76, 0, 67, 0, 74, 71, 0, 76, 71, 67] as const;

const midiFrequency = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** Construction is inert. Call toggle() directly from a user gesture to unlock audio. */
export class ArcadeAudio {
  enabled: boolean = false;
  /** Optional accompaniment; the engine and effects work with this set to false. */
  musicEnabled: boolean = true;

  private graph: AudioGraph | null = null;
  private readonly voices = new Set<Voice>();
  private readonly lastEffects = new Map<EffectKind, number>();
  private disposed = false;
  private toggleVersion = 0;
  private active = false;
  private smoothedSpeed = 0;
  private nextStep = 0;
  private step = 0;

  async toggle(): Promise<boolean> {
    if (this.disposed) return false;

    const version = ++this.toggleVersion;
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.silence(true);
      return false;
    }

    try {
      // This is the only path that constructs an AudioContext.
      this.graph ??= this.createGraph();
      const graph = this.graph;
      if (!graph) {
        this.enabled = false;
        return false;
      }

      if (graph.context.state !== 'running') await graph.context.resume();
      // A second toggle or dispose may have happened while resume was pending.
      if (this.disposed || version !== this.toggleVersion) return this.enabled;
      if (graph.context.state !== 'running') {
        this.enabled = false;
        this.silence(true);
        return false;
      }

      this.ramp(graph.master.gain, 0.35, graph.context.currentTime, 0.025);
      return true;
    } catch {
      // Unsupported devices, autoplay restrictions and closed contexts stay muted.
      if (version === this.toggleVersion) {
        this.enabled = false;
        this.silence(true);
      }
      return this.enabled;
    }
  }

  update(speed: number, boosting: boolean, drifting: boolean, active: boolean, dt: number): void {
    const graph = this.graph;
    if (this.disposed || !this.enabled || !graph || graph.context.state !== 'running' || !active) {
      if (this.active) this.silence(false);
      return;
    }

    const now = graph.context.currentTime;
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(600, speed)) : 0;
    const seconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    if (!this.active) this.smoothedSpeed = safeSpeed;
    this.active = true;
    this.smoothedSpeed += (safeSpeed - this.smoothedSpeed) * (1 - Math.exp(-seconds * 9));

    const pace = this.smoothedSpeed / 600;
    const pitch = 42 + this.smoothedSpeed * 0.58 + (boosting ? 32 : 0);
    this.ramp(graph.carrier.frequency, pitch, now, 0.035);
    this.ramp(graph.sub.frequency, pitch / 2, now, 0.035);
    this.ramp(graph.carrier.detune, drifting ? 22 : 0, now, 0.04);
    this.ramp(graph.filter.frequency, 220 + pace * 1400 + (boosting ? 450 : 0), now, 0.04);
    this.ramp(graph.engine.gain, 0.055 + pace * 0.035 + (boosting ? 0.015 : 0), now, 0.025);
    // A frame heartbeat also fades the sustained engine if animation simply stops.
    graph.engine.gain.setTargetAtTime(0, now + 0.12, 0.025);

    if (!this.musicEnabled) {
      this.ramp(graph.music.gain, 0, now, 0.015);
      this.releaseVoices(false, now);
      this.nextStep = 0;
      this.step = 0;
      return;
    }

    this.ramp(graph.music.gain, 0.65, now, 0.02);
    graph.music.gain.setTargetAtTime(0, now + 0.12, 0.025);
    // Drop stale steps instead of playing a burst after a background tab or hitch.
    if (this.nextStep === 0 || this.nextStep < now - 0.05) {
      this.nextStep = now + 0.012;
      this.step = 0;
    }
    for (let scheduled = 0; scheduled < 2 && this.nextStep <= now + LOOK_AHEAD; scheduled++) {
      this.playStep(this.step, Math.max(now + 0.004, this.nextStep));
      this.step = (this.step + 1) % 16;
      this.nextStep += STEP_SECONDS;
    }
  }

  effect(kind: EffectKind): void {
    const graph = this.graph;
    if (this.disposed || !this.enabled || !graph || graph.context.state !== 'running') return;

    // Effects deliberately bypass the active/music gates so countdowns remain audible.
    const now = graph.context.currentTime;
    const cooldown = kind === 'crash' ? 0.2 : kind === 'near' ? 0.12 : 0.06;
    if (now - (this.lastEffects.get(kind) ?? -Infinity) < cooldown) return;
    this.lastEffects.set(kind, now);
    const start = now + 0.004;

    switch (kind) {
      case 'countdown':
        this.tone('effect', 'sine', 660, start, 0.11, 0.075);
        break;
      case 'go':
        [72, 76, 79].forEach((note, index) => {
          this.tone('effect', 'triangle', midiFrequency(note), start + index * 0.065, 0.19, 0.07);
        });
        break;
      case 'pickup':
        [81, 88, 93].forEach((note, index) => {
          this.tone('effect', 'sine', midiFrequency(note), start + index * 0.04, 0.12, 0.06);
        });
        break;
      case 'near':
        this.tone('effect', 'sine', 520, start, 0.12, 0.055, 1150);
        break;
      case 'crash':
        this.tone('effect', 'triangle', 150, start, 0.23, 0.11, 35);
        this.tone('effect', 'sawtooth', 95, start, 0.16, 0.035, 28);
        break;
      case 'finish':
        [72, 76, 79, 84, 88].forEach((note, index) => {
          this.tone('effect', 'triangle', midiFrequency(note), start + index * 0.085, 0.2, 0.065);
        });
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    ++this.toggleVersion;
    this.silence(true);

    const graph = this.graph;
    this.graph = null;
    if (!graph) return;

    const voices = [...this.voices];
    this.voices.clear();
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      graph.context.onstatechange = null;
      graph.carrier.onended = null;
      for (const voice of voices) {
        voice.oscillator.onended = null;
        voice.oscillator.disconnect();
        voice.envelope.disconnect();
      }
      for (const node of [graph.carrier, graph.sub, graph.subGain, graph.filter,
        graph.engine, graph.music, graph.effects, graph.master]) {
        node.disconnect();
      }
      this.closeContext(graph.context);
    };

    // Use an oscillator's audio-clock end event, not a timer, to allow a final fade.
    graph.carrier.onended = cleanup;
    graph.context.onstatechange = (): void => {
      // An interruption during the fade must not leave cleanup waiting on a stopped clock.
      if (graph.context.state !== 'running') cleanup();
    };
    try {
      const end = graph.context.currentTime + 0.02;
      graph.carrier.stop(end);
      graph.sub.stop(end);
      if (graph.context.state !== 'running') cleanup();
    } catch {
      cleanup();
    }
  }

  private createGraph(): AudioGraph | null {
    const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Context = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Context) return null;

    const context = new Context({ latencyHint: 'interactive' });
    try {
      const master = context.createGain();
      const engine = context.createGain();
      const music = context.createGain();
      const effects = context.createGain();
      const filter = context.createBiquadFilter();
      const carrier = context.createOscillator();
      const sub = context.createOscillator();
      const subGain = context.createGain();
      master.gain.value = 0;
      engine.gain.value = 0;
      music.gain.value = 0;
      effects.gain.value = 0.8;
      subGain.gain.value = 0.3;
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.5;
      carrier.type = 'sawtooth';
      carrier.frequency.value = 42;
      sub.type = 'triangle';
      sub.frequency.value = 21;

      carrier.connect(filter);
      sub.connect(subGain).connect(filter);
      filter.connect(engine).connect(master);
      music.connect(master);
      effects.connect(master);
      master.connect(context.destination);
      carrier.start();
      sub.start();
      return { context, master, engine, music, effects, filter, carrier, sub, subGain };
    } catch (error) {
      this.closeContext(context);
      throw error;
    }
  }

  private playStep(step: number, time: number): void {
    if (step % 4 === 0) {
      this.tone('music', 'sine', 125, time, 0.15, 0.12, 42);
    }
    if (step % 8 === 4) {
      // Pitched, short transients instead of sampled or generated white noise.
      this.tone('music', 'triangle', 190, time, 0.085, 0.055, 75);
      this.tone('music', 'sine', 1700, time, 0.045, 0.023, 700);
    }
    if (step % 2 === 1) {
      this.tone('music', 'square', 6200, time, 0.026, 0.009, 4100);
    }
    if (step % 2 === 0) {
      const note = BASS[step / 2] ?? 45;
      this.tone('music', 'triangle', midiFrequency(note), time, 0.18, 0.085);
    }
    const melody = MELODY[step] ?? 0;
    if (melody !== 0) {
      this.tone('music', 'triangle', midiFrequency(melody), time, 0.16, 0.028);
    }
  }

  private tone(bus: VoiceBus, type: OscillatorType, frequency: number, time: number,
    duration: number, volume: number, endFrequency: number = frequency): void {
    const graph = this.graph;
    if (!graph || this.voices.size >= MAX_VOICES) return;

    const oscillator = graph.context.createOscillator();
    const envelope = graph.context.createGain();
    const voice: Voice = { oscillator, envelope, bus, releasing: false };
    const start = Math.max(time, graph.context.currentTime);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== frequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }
    envelope.gain.setValueAtTime(0, graph.context.currentTime);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(Math.min(volume, 0.12), start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.gain.linearRampToValueAtTime(0, start + duration + 0.008);
    oscillator.connect(envelope).connect(bus === 'music' ? graph.music : graph.effects);
    oscillator.onended = (): void => {
      this.voices.delete(voice);
      oscillator.disconnect();
      envelope.disconnect();
      oscillator.onended = null;
    };
    this.voices.add(voice);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.012);
  }

  private silence(includeEffects: boolean): void {
    this.active = false;
    this.nextStep = 0;
    this.step = 0;
    this.smoothedSpeed = 0;
    const graph = this.graph;
    if (!graph) return;
    const now = graph.context.currentTime;
    this.ramp(graph.engine.gain, 0, now, 0.015);
    this.ramp(graph.music.gain, 0, now, 0.015);
    if (includeEffects) {
      this.ramp(graph.master.gain, 0, now, 0.015);
      this.lastEffects.clear();
    }
    this.releaseVoices(includeEffects, now);
  }

  private releaseVoices(includeEffects: boolean, now: number): void {
    for (const voice of this.voices) {
      if (voice.releasing || (!includeEffects && voice.bus !== 'music')) continue;
      voice.releasing = true;
      this.ramp(voice.envelope.gain, 0, now, 0.012);
      // Also cancels notes that were scheduled ahead but haven't started yet.
      voice.oscillator.stop(now + 0.015);
    }
  }

  private ramp(parameter: AudioParam, value: number, now: number, duration: number): void {
    if (typeof parameter.cancelAndHoldAtTime === 'function') {
      parameter.cancelAndHoldAtTime(now);
    } else {
      const current = parameter.value;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.linearRampToValueAtTime(value, now + duration);
  }

  private closeContext(context: AudioContext): void {
    try {
      void context.close().catch(() => undefined);
    } catch {
      // Some implementations throw synchronously when already closed.
    }
  }
}