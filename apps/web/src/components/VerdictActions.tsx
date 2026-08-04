import { type CSSProperties, useState } from "react";
import type { Language } from "../lib/i18n";
import { pick } from "../lib/i18n";

export type VerdictZone = "northwest" | "northeast" | "southwest" | "southeast";

type VerdictQuadrant = {
  index: string;
  zone: VerdictZone;
  label: readonly [string, string];
  note: readonly [string, string];
  body: readonly [string, string];
};

const QUADRANTS: VerdictQuadrant[] = [
  {
    index: "04",
    zone: "northwest",
    label: ["MORE EVIDENCE NEEDED", "证据尚不足"],
    note: ["EVIDENCE UNRESOLVED", "尚无法定论"],
    body: [
      "The receipt cannot support a trustworthy signing action yet.",
      "现有回执不足以支持可信的签署决策。",
    ],
  },
  {
    index: "01",
    zone: "northeast",
    label: ["READY TO SIGN", "可以签署"],
    note: ["NO BLOCKING EVIDENCE", "未发现阻断证据"],
    body: [
      "The checked scope contains no blocking evidence. This is not a promise of safety.",
      "在本次核验范围内，未发现阻断签署的证据；但这并非安全承诺。",
    ],
  },
  {
    index: "03",
    zone: "southwest",
    label: ["DO NOT SIGN", "请勿签署"],
    note: ["EXECUTION BLOCKED", "执行不可行"],
    body: [
      "The current path cannot execute or cannot satisfy the stated boundary.",
      "当前路径无法执行，或无法满足既定边界。",
    ],
  },
  {
    index: "02",
    zone: "southeast",
    label: ["REVISE & RERUN", "调整后重跑"],
    note: ["CURRENT VERDICT", "当前判定"],
    body: [
      "Change the condition identified by the evidence, then replay before signing.",
      "请按证据指向调整交易条件，并在签署前重新回放。",
    ],
  },
];

const DOT_COUNTS: Record<VerdictZone, number> = {
  northwest: 7,
  northeast: 10,
  southwest: 6,
  southeast: 14,
};

const ZONE_BOUNDS: Record<
  VerdictZone,
  { left: number; top: number; width: number; height: number }
> = {
  northwest: { left: 27, top: 12, width: 17, height: 31 },
  northeast: { left: 56, top: 12, width: 17, height: 31 },
  southwest: { left: 27, top: 57, width: 17, height: 32 },
  southeast: { left: 56, top: 57, width: 17, height: 32 },
};

function createReceiptDots() {
  let seed = 0x50415241;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  return (Object.keys(DOT_COUNTS) as VerdictZone[]).flatMap((zone) => {
    const bounds = ZONE_BOUNDS[zone];
    return Array.from({ length: DOT_COUNTS[zone] }, (_, index) => ({
      id: `${zone}-${index}`,
      zone,
      x: bounds.left + random() * bounds.width,
      y: bounds.top + random() * bounds.height,
      size: 8 + random() * 13,
      delay: random() * -4,
    }));
  });
}

const RECEIPT_DOTS = createReceiptDots();

type VerdictPointerEvent = { pointerType: string };

export function createVerdictInteractionHandlers(
  zone: VerdictZone,
  selectZone: (zone: VerdictZone) => void,
) {
  return {
    onFocus: () => selectZone(zone),
    onPointerDown: (event: VerdictPointerEvent) => {
      if (event.pointerType === "touch") selectZone(zone);
    },
    onPointerEnter: (event: VerdictPointerEvent) => {
      if (event.pointerType !== "touch") selectZone(zone);
    },
  };
}

export function VerdictActions({ language }: { language: Language }) {
  const [selectedZone, setSelectedZone] = useState<VerdictZone>("southeast");
  const selectedQuadrant =
    QUADRANTS.find((quadrant) => quadrant.zone === selectedZone) ??
    QUADRANTS[3];

  return (
    <div className="verdict-actions">
      <div
        className="verdict-field"
        data-activation="pointer"
        data-verdict-field=""
      >
        <div className="verdict-field-caption" aria-hidden="true">
          <span>
            {pick(
              language,
              "37 REPLAY RECEIPTS / INTERACTIVE DEMO",
              "37 份回放回执 / 交互演示",
            )}
          </span>
          <span>
            {pick(
              language,
              "MOVE THE POINTER TO EXPLORE",
              "移动指针，查看结论",
            )}
          </span>
        </div>
        <span
          className="verdict-field-axis verdict-field-axis-x"
          aria-hidden="true"
        />
        <span
          className="verdict-field-axis verdict-field-axis-y"
          aria-hidden="true"
        />

        <div className="verdict-dot-layer" aria-hidden="true">
          {RECEIPT_DOTS.map((dot) => (
            <span
              className="verdict-receipt-dot"
              data-receipt-dot=""
              data-selected={dot.zone === selectedZone ? "true" : undefined}
              data-zone={dot.zone}
              key={dot.id}
              style={
                {
                  "--dot-delay": `${dot.delay}s`,
                  "--dot-size": `${dot.size}px`,
                  "--dot-x": `${dot.x}%`,
                  "--dot-y": `${dot.y}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>

        {QUADRANTS.map((quadrant) => {
          const selected = quadrant.zone === selectedZone;
          const interactionHandlers = createVerdictInteractionHandlers(
            quadrant.zone,
            setSelectedZone,
          );
          return (
            <button
              aria-pressed={selected}
              className="verdict-quadrant"
              data-current-action={selected ? "true" : undefined}
              data-verdict-choice=""
              data-zone={quadrant.zone}
              key={quadrant.index}
              onFocus={interactionHandlers.onFocus}
              onPointerDown={interactionHandlers.onPointerDown}
              onPointerEnter={interactionHandlers.onPointerEnter}
              type="button"
            >
              <div className="verdict-quadrant-meta">
                <span>{quadrant.index}</span>
                <b>{pick(language, quadrant.note[0], quadrant.note[1])}</b>
              </div>
              <h3>{pick(language, quadrant.label[0], quadrant.label[1])}</h3>
              <p>{pick(language, quadrant.body[0], quadrant.body[1])}</p>
            </button>
          );
        })}

        <div className="verdict-field-center" data-verdict-center="">
          <span>{pick(language, "SELECTED FIELD", "当前判读")}</span>
          <i aria-hidden="true" />
          <strong>
            {DOT_COUNTS[selectedZone]} / 37
            <small>
              {pick(
                language,
                selectedQuadrant.label[0],
                selectedQuadrant.label[1],
              )}
            </small>
          </strong>
        </div>
      </div>
    </div>
  );
}
