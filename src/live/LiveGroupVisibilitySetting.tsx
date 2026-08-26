import "./live-group-list.css";

type Props = {
  discoverable: boolean;
  onChange: (discoverable: boolean) => void;
  disabled?: boolean;
  labels: {
    title: string;
    description: string;
  };
};

export function LiveGroupVisibilitySetting({
  discoverable,
  onChange,
  disabled = false,
  labels,
}: Props) {
  return (
    <label className="live-group-visibility-setting">
      <span className="live-group-visibility-setting__copy">
        <strong>{labels.title}</strong>
        <span>{labels.description}</span>
      </span>
      <input
        type="checkbox"
        checked={discoverable}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
