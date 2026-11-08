import { useState } from "react";
import type { InspectedBrowserElement } from "@/lib/ade/browser/api";

/** Live CSS controls for the first selected element; changes apply to the full selection. */
export function BrowserAnnotationStyles({
  element,
  apply,
}: {
  element: InspectedBrowserElement;
  apply: (property: string, value: string) => void;
}) {
  const initial = Object.fromEntries(
    element.styles.split(";").map((declaration) => {
      const colon = declaration.indexOf(":");
      return colon < 0
        ? ["", ""]
        : [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>({
    ...initial,
    width: String(Math.round(element.rect.width)),
    height: String(Math.round(element.rect.height)),
    "font-size": String(Math.round(parseFloat(initial["font-size"] ?? "") || 16)),
    "border-radius": String(Math.round(parseFloat(initial["border-radius"] ?? "") || 0)),
    "border-width": String(Math.round(parseFloat(initial["border-width"] ?? "") || 0)),
  });
  const [locked, setLocked] = useState(true);
  const ratio = element.rect.height > 0 ? element.rect.width / element.rect.height : 1;
  const update = (property: string, value: string, cssValue = value) => {
    setValues((current) => ({ ...current, [property]: value }));
    if (cssValue.trim()) apply(property, cssValue.trim());
  };
  const field = (property: string, label: string, placeholder = "") => (
    <label key={property} className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
      <span>{label}</span>
      <input
        aria-label={label}
        value={values[property] ?? ""}
        placeholder={placeholder}
        onChange={(event) =>
          setValues((current) => ({ ...current, [property]: event.target.value }))
        }
        onBlur={(event) => {
          if (event.target.value.trim()) apply(property, event.target.value.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="min-w-0 rounded border border-line bg-paper p-1"
      />
    </label>
  );
  const number = (property: string, label: string, min: number, max: number) => (
    <label key={property} className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={values[property] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            update(property, value, value ? `${value}px` : "");
            if (property === "border-width" && value) apply("border-style", "solid");
            if (
              locked &&
              value &&
              Number(value) > 0 &&
              (property === "width" || property === "height")
            ) {
              const other = property === "width" ? "height" : "width";
              const next = Math.max(
                1,
                Math.round(property === "width" ? Number(value) / ratio : Number(value) * ratio),
              );
              setValues((current) => ({ ...current, [other]: String(next) }));
              apply(other, `${next}px`);
            }
          }}
          className="min-w-0 w-full rounded border border-line bg-paper p-1"
        />
        <span>px</span>
      </span>
    </label>
  );
  const color = (property: string, label: string) => {
    const value = values[property] ?? "";
    const match = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
    const swatch = /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : match
        ? `#${match
            .slice(1)
            .map((part) => Number(part).toString(16).padStart(2, "0"))
            .join("")}`
        : "#000000";
    return (
      <label key={property} className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
        <span>{label}</span>
        <span className="flex gap-1">
          <input
            aria-label={`${label} picker`}
            type="color"
            value={swatch}
            onChange={(event) => update(property, event.target.value)}
            className="h-7 w-7 shrink-0"
          />
          <input
            aria-label={`${label} value`}
            value={value}
            onChange={(event) =>
              setValues((current) => ({ ...current, [property]: event.target.value }))
            }
            onBlur={(event) => {
              if (event.target.value.trim()) apply(property, event.target.value.trim());
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="min-w-0 w-full rounded border border-line bg-paper p-1"
          />
        </span>
      </label>
    );
  };
  return (
    <div className="grid gap-2">
      <label className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
        <span>Font</span>
        <select
          aria-label="Font"
          value={
            ["inherit", "system-ui", "sans-serif", "serif", "monospace"].includes(
              values["font-family"] ?? "",
            )
              ? values["font-family"]
              : "inherit"
          }
          onChange={(event) => update("font-family", event.target.value)}
          className="rounded border border-line bg-paper p-1"
        >
          {["inherit", "system-ui", "sans-serif", "serif", "monospace"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {number("font-size", "Font size", 1, 300)}
      <label className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
        <span>Font weight</span>
        <select
          aria-label="Font weight"
          value={values["font-weight"] ?? "400"}
          onChange={(event) => update("font-weight", event.target.value)}
          className="rounded border border-line bg-paper p-1"
        >
          {["300", "400", "500", "600", "700", "800", "900"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {field("line-height", "Line height", "normal / 1.4")}
      {color("color", "Text color")}
      {color("background-color", "Background")}
      <label className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
        <span>Opacity</span>
        <input
          aria-label="Opacity"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={values["opacity"] ?? "1"}
          onChange={(event) => update("opacity", event.target.value)}
        />
      </label>
      {number("border-radius", "Radius", 0, 300)}
      {color("border-color", "Border color")}
      {number("border-width", "Border width", 0, 100)}
      <button
        type="button"
        aria-pressed={locked}
        onClick={() => setLocked((value) => !value)}
        className="justify-self-end rounded border border-line px-2 py-1"
      >
        {locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
      </button>
      {number("width", "Width", 1, 10000)}
      {number("height", "Height", 1, 10000)}
      {field("padding", "Padding", "0 0 0 0")}
      {field("margin", "Margin", "0 0 0 0")}
      {field("gap", "Gap", "0px")}
    </div>
  );
}
