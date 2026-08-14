/**
 * The notification sound.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file: two
 * short sine tones need no asset, no format negotiation between browsers, and
 * no extra request — and a committed binary is something nobody can review in a
 * diff.
 *
 * Deliberately quiet and brief. A notification tone in a security dashboard is
 * heard while somebody is concentrating on something else, so it is a soft
 * two-note interval at low gain rather than an alert.
 *
 * Browser autoplay policy is respected, not worked around: an AudioContext
 * created before the user has interacted with the page starts suspended, and
 * `resume()` outside a user gesture is rejected. That rejection is swallowed —
 * a missed tone must never surface as an error, and the notification itself
 * still arrives in the UI.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  // One context for the page. Browsers cap how many can exist, and creating one
  // per notification exhausts that limit on a busy instance.
  if (!context || context.state === 'closed') {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/** A single soft tone. */
function tone(ctx: AudioContext, frequency: number, startAt: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  // Ramped rather than switched: an instantaneous gain change produces an
  // audible click at the start and end of the tone.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.06, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/**
 * Plays the notification tone, if the browser allows it.
 *
 * Never throws and never rejects: callers use it as a side effect of an event
 * arriving, and a blocked AudioContext is normal operation rather than a fault.
 */
export async function playNotificationSound(): Promise<void> {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return;

    const now = ctx.currentTime;
    // A rising major sixth — E6 then C#7. Reads as "ready", not as "alarm".
    tone(ctx, 1318.5, now, 0.09);
    tone(ctx, 2217.5, now + 0.085, 0.13);
  } catch {
    // Autoplay policy, a closed context, or an unsupported browser.
  }
}
