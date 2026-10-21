"use client";

import { COLOR_KEYS, type ColorKey } from "@/shared/constants";

const NAMES: Record<ColorKey, string> = {
  purple: "Purple", green: "Green", blue: "Blue", teal: "Teal", amber: "Amber", orange: "Orange", red: "Red", pink: "Pink", gray: "Grey",
};

/** Colours come from a fixed palette, so there is nothing to type and nothing to inject. */
export function ColorPicker({ name, value, onChange }: { name: string; value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {COLOR_KEYS.map((c) => (
        <label key={c} className={`swatch tone-${c}`} title={NAMES[c]}>
          <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} aria-label={NAMES[c]} />
          <span />
        </label>
      ))}
    </div>
  );
}
