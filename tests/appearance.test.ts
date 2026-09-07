import assert from "node:assert/strict";
import test from "node:test";
import {
  isAppearancePreference,
  loadAppearancePreference,
  resolveAppearance,
  saveAppearancePreference,
} from "../src/settings/appearance.ts";

function installWindowStorage(initial?: Record<string, string>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map(Object.entries(initial ?? {}));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          values.set(key, value);
        },
      },
    },
  });
  return {
    values,
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

test("appearance accepts only system, light and dark", () => {
  assert.equal(isAppearancePreference("system"), true);
  assert.equal(isAppearancePreference("light"), true);
  assert.equal(isAppearancePreference("dark"), true);
  assert.equal(isAppearancePreference("auto-dark"), false);
});

test("system appearance follows the OS preference while explicit choices win", () => {
  assert.equal(resolveAppearance("system", true), "dark");
  assert.equal(resolveAppearance("system", false), "light");
  assert.equal(resolveAppearance("light", true), "light");
  assert.equal(resolveAppearance("dark", false), "dark");
});

test("appearance preference persists locally and invalid stored data falls back to system", () => {
  const fakeWindow = installWindowStorage();
  try {
    assert.equal(loadAppearancePreference(), "system");
    assert.equal(saveAppearancePreference("dark"), true);
    assert.equal(loadAppearancePreference(), "dark");
    fakeWindow.values.set("verteil-flyer:appearance", "<script>bad</script>");
    assert.equal(loadAppearancePreference(), "system");
  } finally {
    fakeWindow.restore();
  }
});
