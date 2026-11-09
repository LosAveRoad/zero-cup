/**
 * 原生 Web Audio 造物声景合成器（零外部音频资源依赖）。
 *
 * 通过物理谐波叠加合成陶轮低鸣、青花落笔、窑火点燃与成瓷“叩之声如磬”的清越钟罄声。
 * 在无头浏览器或未解锁音频上下文的环境中自动安全降级，绝不抛出异常。
 */

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    if (!sharedContext) {
      sharedContext = new AudioCtx();
    }
    if (sharedContext.state === 'suspended') {
      void sharedContext.resume().catch(() => undefined);
    }
    return sharedContext;
  } catch {
    return null;
  }
}

/** 拉坯调型时的温润陶轮泛音。 */
export function playWheelTone(enabled: boolean, radiusRatio = 0.5): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 180 + Math.max(0, Math.min(1, 1 - radiusRatio)) * 160;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.12, now + 0.09);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // 忽略受限环境的音频异常
  }
}

/** 青花落笔与钤印时的清润水墨触感音。 */
export function playBrushSound(enabled: boolean, isStamp = false): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isStamp ? 'triangle' : 'sine';
    const startFreq = isStamp ? 520 : 680;
    const endFreq = isStamp ? 310 : 440;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.08);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(isStamp ? 0.06 : 0.035, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // 忽略受限环境的音频异常
  }
}

/** 入窑引火时的温厚窑炉共鸣音。 */
export function playKilnIgniteSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const freqs = [130.81, 196.0, 261.63];
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.06, now + 0.65);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.03, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.72);
    }
  } catch {
    // 忽略受限环境的音频异常
  }
}

/** 1310°C 烧制完成出窑时的“叩之声如磬”青花瓷清音。 */
export function playPorcelainChime(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    // 薄胎白瓷敲击泛音列（基频 C6 + 瓷质非谐泛音）
    const partials: { freq: number; amp: number; decay: number }[] = [
      { freq: 1046.5, amp: 0.07, decay: 1.4 },
      { freq: 2489.0, amp: 0.04, decay: 0.9 },
      { freq: 4186.0, amp: 0.02, decay: 0.55 },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(partial.freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(partial.amp, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + partial.decay + 0.05);
    }
  } catch {
    // 忽略受限环境的音频异常
  }
}

// 五声调式音高频率与唱名映射（覆盖 G5 ~ C7 清越瓷音区）
const N = {
  G5: { freq: 783.99, label: '徵' },
  A5: { freq: 880.0, label: '羽' },
  C6: { freq: 1046.5, label: '宫' },
  D6: { freq: 1174.66, label: '商' },
  E6: { freq: 1318.51, label: '角' },
  G6: { freq: 1567.98, label: '徵' },
  A6: { freq: 1760.0, label: '羽' },
  C7: { freq: 2093.0, label: '宫' },
} as const;

type NoteKey = keyof typeof N;

export interface PentatonicMelody {
  id: string;
  title: string;
  notes: NoteKey[];
}

export const PENTATONIC_MELODIES: PentatonicMelody[] = [
  {
    id: 'molihua',
    title: '《茉莉花》',
    // 3 3 5 6 1' 1' 6 5 5 6 5 | 3 3 5 6 1' 1' 6 5 5 6 5 | 5 5 5 3 5 6 6 5 | 3 2 3 5 3 2 1 1 2 1
    notes: [
      'E6',
      'E6',
      'G6',
      'A6',
      'C7',
      'C7',
      'A6',
      'G6',
      'G6',
      'A6',
      'G6',
      'E6',
      'E6',
      'G6',
      'A6',
      'C7',
      'C7',
      'A6',
      'G6',
      'G6',
      'A6',
      'G6',
      'G6',
      'G6',
      'G6',
      'E6',
      'G6',
      'A6',
      'A6',
      'G6',
      'E6',
      'D6',
      'E6',
      'G6',
      'E6',
      'D6',
      'C6',
      'C6',
      'D6',
      'C6',
    ],
  },
  {
    id: 'canghai',
    title: '《沧海一声笑》',
    // 6 5 3 2 1 | 3 2 1 6, 5, | 5, 6, 5, 6, 1 2 3 5 | 6 5 3 2 1 2
    notes: [
      'A6',
      'G6',
      'E6',
      'D6',
      'C6',
      'E6',
      'D6',
      'C6',
      'A5',
      'G5',
      'G5',
      'A5',
      'G5',
      'A5',
      'C6',
      'D6',
      'E6',
      'G6',
      'A6',
      'G6',
      'E6',
      'D6',
      'C6',
      'D6',
    ],
  },
  {
    id: 'caiyun',
    title: '《彩云追月》',
    // 1 2 3 5 6 | 3 5 2 3 1 | 6, 1 6, 5, | 1 2 3 5 6 | 1' 6 5 3 5
    notes: [
      'C6',
      'D6',
      'E6',
      'G6',
      'A6',
      'E6',
      'G6',
      'D6',
      'E6',
      'C6',
      'A5',
      'C6',
      'A5',
      'G5',
      'C6',
      'D6',
      'E6',
      'G6',
      'A6',
      'C7',
      'A6',
      'G6',
      'E6',
      'G6',
    ],
  },
  {
    id: 'yuzhou',
    title: '《渔舟唱晚》',
    // 3 5 6 1' | 6 5 3 2 | 1 2 3 5 | 2 3 1 6, | 5, 6, 1 2 | 3 2 1 1
    notes: [
      'E6',
      'G6',
      'A6',
      'C7',
      'A6',
      'G6',
      'E6',
      'D6',
      'C6',
      'D6',
      'E6',
      'G6',
      'D6',
      'E6',
      'C6',
      'A5',
      'G5',
      'A5',
      'C6',
      'D6',
      'E6',
      'D6',
      'C6',
      'C6',
    ],
  },
];

let currentMelodyIndex = Math.floor(Math.random() * PENTATONIC_MELODIES.length);
let currentNoteIndex = 0;

/** 随机切换一首五声调式瓷音曲目，并从第一个音符开始。 */
export function resetPorcelainMelody(): string {
  const nextOffset =
    1 + Math.floor(Math.random() * (PENTATONIC_MELODIES.length - 1));
  currentMelodyIndex =
    (currentMelodyIndex + nextOffset) % PENTATONIC_MELODIES.length;
  currentNoteIndex = 0;
  return PENTATONIC_MELODIES[currentMelodyIndex].title;
}

/** 获取当前随机选中的五声调式曲目名称。 */
export function currentPorcelainMelodyTitle(): string {
  return PENTATONIC_MELODIES[currentMelodyIndex].title;
}

/**
 * 成品阶段用小金属棒轻叩瓷身时，每次敲击只发出当前五声调式曲目的一个清脆瓷音。
 * 整首曲目敲完后自动随机切换到下一首经典五声曲目。
 */
export function playPorcelainTapSound(): {
  songTitle: string;
  noteLabel: string;
} {
  const melody = PENTATONIC_MELODIES[currentMelodyIndex];
  const noteKey = melody.notes[currentNoteIndex];
  const note = N[noteKey];

  currentNoteIndex += 1;
  if (currentNoteIndex >= melody.notes.length) {
    resetPorcelainMelody();
  }

  const ctx = getAudioContext();
  if (!ctx) {
    return { songTitle: melody.title, noteLabel: note.label };
  }
  try {
    const now = ctx.currentTime;
    const baseFreq = note.freq;

    // 单次敲击只产生一个干净晶莹的瓷钟单音（基音 + 同刻泛音，无延迟重音）
    const partials = [
      { freq: baseFreq, amp: 0.13, decay: 0.92 },
      { freq: baseFreq * 2.41, amp: 0.055, decay: 0.42 },
      { freq: baseFreq * 3.86, amp: 0.026, decay: 0.16 },
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.amp, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + p.decay + 0.03);
    }
  } catch {
    // 忽略受限环境的音频异常
  }
  return { songTitle: melody.title, noteLabel: note.label };
}
