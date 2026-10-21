//! A calm Material 3 determinate bar (port of `src/ui/progress.tsx`): the filled part, a small gap, the track with a dot at its end. It does not
//! animate on its own; only the width follows the value, and its box is fixed so a changing number never shifts the lines around it.
use leptos::prelude::*;

/// The value as the bar shows it: clamped to 0..=1 (NaN is 0).
pub fn clamp_ratio(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

/// Whole percent for `aria-valuenow`.
pub fn percent(value: f64) -> i64 {
    (clamp_ratio(value) * 100.0).round() as i64
}

/// At (almost) one the track and its dot disappear.
pub fn is_full(value: f64) -> bool {
    clamp_ratio(value) >= 0.999
}

#[component]
pub fn Progress(#[prop(into)] value: Signal<f64>, label: &'static str) -> impl IntoView {
    view! {
        <div
            class="v5-progress"
            style:--p=move || clamp_ratio(value.get()).to_string()
            data-full=move || is_full(value.get()).to_string()
            role="progressbar"
            aria-label=label
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=move || percent(value.get())
        >
            <i></i>
            <i></i>
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_clamped_and_rounded() {
        assert_eq!(clamp_ratio(-1.0), 0.0);
        assert_eq!(clamp_ratio(f64::NAN), 0.0);
        assert_eq!(clamp_ratio(2.0), 1.0);
        assert_eq!(percent(0.426), 43);
        assert!(is_full(0.9995) && !is_full(0.99));
    }
}
