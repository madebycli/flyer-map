import type { AppearancePreference } from "./appearance.ts";
import "./appearance-control.css";

export type AppearanceControlLabels = {
  title: string;
  system: string;
  light: string;
  dark: string;
};

type Props = {
  value: AppearancePreference;
  labels: AppearanceControlLabels;
  onChange: (preference: AppearancePreference) => void;
};

const OPTIONS: AppearancePreference[] = ["system", "light", "dark"];

export function AppearanceControl({ value, labels, onChange }: Props) {
  return (
    <fieldset className="appearance-control">
      <legend>{labels.title}</legend>
      <div className="appearance-control-options">
        {OPTIONS.map((option) => (
          <label className="appearance-control-option" key={option}>
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{labels[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
