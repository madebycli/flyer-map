//! A very short tone that confirms a mark, made with the browser's audio (no sound file, nothing to download). The audio context is made on the
//! first tone, which happens inside a tap, because browsers only allow sound after a gesture. Fails quietly where there is no audio.
use std::cell::RefCell;
use web_sys::{AudioContext, OscillatorType};

thread_local! {
    static CONTEXT: RefCell<Option<AudioContext>> = const { RefCell::new(None) };
}

/// How long the tone lasts, seconds, and its pitch.
const LENGTH_S: f64 = 0.05;
const PITCH_HZ: f32 = 880.0;
const LOUDNESS: f32 = 0.05;

fn play(ctx: &AudioContext) -> Option<()> {
    let _ = ctx.resume();
    let osc = ctx.create_oscillator().ok()?;
    let gain = ctx.create_gain().ok()?;
    osc.set_type(OscillatorType::Sine);
    osc.frequency().set_value(PITCH_HZ);
    gain.gain().set_value(LOUDNESS);
    osc.connect_with_audio_node(&gain).ok()?;
    gain.connect_with_audio_node(&ctx.destination()).ok()?;
    osc.start().ok()?;
    osc.stop_with_when(ctx.current_time() + LENGTH_S).ok()
}

/// Play the tone, if the person wants it. Returns whether it started.
pub fn tick(sound_on: bool) -> bool {
    if !sound_on {
        return false;
    }
    CONTEXT.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = AudioContext::new().ok();
        }
        slot.as_ref().and_then(play).is_some()
    })
}

/// The buzz and the tone together, as the person chose them.
pub fn confirm(haptics_on: bool, sound_on: bool) {
    super::vibrate::tick(haptics_on);
    tick(sound_on);
}
