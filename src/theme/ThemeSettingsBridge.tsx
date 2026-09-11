import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  loadUiThemePreference,
  saveUiThemePreference,
  subscribeUiThemePreference,
  type UiThemePreference,
} from "./uiTheme";

function ThemeSettingsControl() {
  const [preference, setPreference] = useState<UiThemePreference>(loadUiThemePreference);

  useEffect(() => subscribeUiThemePreference(setPreference), []);

  const changeTheme = (next: UiThemePreference) => {
    setPreference(next);
    saveUiThemePreference(next);
  };

  return (
    <section className="settings-section ui-theme-settings-section" data-ui-theme-settings="true">
      <h3>Darstellung</h3>
      <label className="field-label">
        <span>Farbmodus</span>
        <select
          className="ui-theme-select"
          value={preference}
          onChange={(event) => changeTheme(event.target.value as UiThemePreference)}
          aria-label="Farbmodus"
        >
          <option value="dark">Dunkel</option>
          <option value="light">Hell</option>
          <option value="system">Geräteeinstellung</option>
        </select>
      </label>
      <p className="ui-theme-hint">
        Dunkel ist die Standardeinstellung. „Geräteeinstellung“ folgt automatisch dem Hell-/Dunkelmodus deines Geräts. Die Karte selbst bleibt immer im hellen Kartenstil.
      </p>
    </section>
  );
}

export function ThemeSettingsBridge() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const findTarget = () => {
      setTarget(document.querySelector(".settings-field-hub-content"));
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target) return null;
  return createPortal(<ThemeSettingsControl />, target);
}
