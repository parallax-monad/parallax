import { type CSSProperties, useState } from "react";
import type { Language } from "../lib/i18n";
import { pick } from "../lib/i18n";

export type VerdictZone = "northwest" | "northeast" | "southwest" | "southeast";

type VerdictQuadrant = {
  index: string;
  zone: VerdictZone;
  tone: "evidence" | "ready" | "blocked" | "rerun";
  label: readonly [string, string];
  note: readonly [string, string];
  body: readonly [string, string];
};

const QUADRANTS: VerdictQuadrant[] = [
  {
    index: "04",
    zone: "northwest",
    tone: "evidence",
    label: ["MORE EVIDENCE NEEDED", "证据尚不足"],
    note: ["EVIDENCE UNRESOLVED", "尚无法定论"],
    body: [
      "Collect the missing evidence before drawing a conclusion.",
      "先补齐缺失证据，再形成结论。",
    ],
  },
  {
    index: "01",
    zone: "northeast",
    tone: "ready",
    label: ["NO BLOCKING EVIDENCE", "未发现阻断证据"],
    note: ["IN THIS DEMO SCOPE", "演示范围内"],
    body: [
      "No blocking evidence was found in this demo scope. This evidence assessment is not a safety guarantee.",
      "演示范围内未发现阻断证据；本次证据判断并不代表安全保证。",
    ],
  },
  {
    index: "03",
    zone: "southwest",
    tone: "blocked",
    label: ["DO NOT SIGN", "请勿签署"],
    note: ["EXECUTION BLOCKED", "执行不可行"],
    body: [
      "Do not sign: the route cannot execute or meet the stated limits.",
      "请勿签署：当前路径无法执行，或无法满足既定限制。",
    ],
  },
  {
    index: "02",
    zone: "southeast",
    tone: "rerun",
    label: ["REVISE & RERUN", "调整后重跑"],
    note: ["CURRENT VERDICT", "当前判定"],
    body: [
      "Revise the evidence-identified condition, then rerun the assessment.",
      "按证据指向调整交易条件，再重新进行判断。",
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

const DEMO_VOTE_DOTS = createReceiptDots();

const USER_VOTE_POSITION: Record<VerdictZone, { x: number; y: number }> = {
  northwest: { x: 39, y: 34 },
  northeast: { x: 61, y: 33 },
  southwest: { x: 39, y: 72 },
  southeast: { x: 61, y: 72 },
};

type VerdictPointerEvent = { pointerType: string };

export function createVerdictInteractionHandlers(
  zone: VerdictZone,
  previewZone: (zone: VerdictZone) => void,
  voteZone: (zone: VerdictZone) => void = previewZone,
) {
  return {
    onClick: () => voteZone(zone),
    onFocus: () => previewZone(zone),
    onPointerDown: (event: VerdictPointerEvent) => {
      if (event.pointerType === "touch") voteZone(zone);
    },
    onPointerEnter: (event: VerdictPointerEvent) => {
      if (event.pointerType !== "touch") previewZone(zone);
    },
  };
}

export function VerdictActions({ language }: { language: Language }) {
  const [previewZone, setPreviewZone] = useState<VerdictZone | null>(null);
  const [selectedZone, setSelectedZone] = useState<VerdictZone | null>(null);
  const activeZone = previewZone ?? selectedZone;
  const activeQuadrant = QUADRANTS.find(
    (quadrant) => quadrant.zone === activeZone,
  );
  const totalVotes = 37 + (selectedZone ? 1 : 0);
  const voteCount = (zone: VerdictZone) =>
    DOT_COUNTS[zone] + (selectedZone === zone ? 1 : 0);

  return (
    <div className="verdict-actions">
      <p className="sr-only" id="verdict-vote-instructions">
        {pick(
          language,
          "Choose one verdict. You have one vote. Choosing another verdict moves your vote.",
          "请选择一个结论。每人只有一票；选择其他结论会移动你的投票。",
        )}
      </p>
      <div
        className="verdict-field"
        data-activation="vote"
        data-verdict-field=""
        onPointerLeave={() => setPreviewZone(null)}
      >
        <div className="verdict-field-caption" aria-hidden="true">
          <span>
            {pick(
              language,
              `${totalVotes} DEMO VOTES / INTERACTIVE POLL`,
              `${totalVotes} 张演示票 / 互动投票`,
            )}
          </span>
          <span>
            {pick(
              language,
              "ONE PERSON / ONE VOTE · CLICK TO MOVE",
              "一人一票 · 点击改投",
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
          {DEMO_VOTE_DOTS.map((dot) => (
            <span
              className="verdict-vote-dot"
              data-selected={dot.zone === activeZone ? "true" : undefined}
              data-vote-dot=""
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
          {selectedZone ? (
            <span
              className="verdict-vote-dot"
              data-selected={selectedZone === activeZone ? "true" : undefined}
              data-user-vote=""
              data-vote-dot=""
              data-zone={selectedZone}
              style={
                {
                  "--dot-delay": "0s",
                  "--dot-size": "20px",
                  "--dot-x": `${USER_VOTE_POSITION[selectedZone].x}%`,
                  "--dot-y": `${USER_VOTE_POSITION[selectedZone].y}%`,
                } as CSSProperties
              }
            />
          ) : null}
        </div>

        {QUADRANTS.map((quadrant) => {
          const selected = quadrant.zone === selectedZone;
          const active = quadrant.zone === activeZone;
          const interactionHandlers = createVerdictInteractionHandlers(
            quadrant.zone,
            setPreviewZone,
            setSelectedZone,
          );
          return (
            <button
              aria-describedby="verdict-vote-instructions"
              aria-pressed={selected}
              className="verdict-quadrant"
              data-current-action={active ? "true" : undefined}
              data-verdict-choice=""
              data-verdict-tone={quadrant.tone}
              data-zone={quadrant.zone}
              key={quadrant.index}
              onBlur={() => setPreviewZone(null)}
              onClick={interactionHandlers.onClick}
              onFocus={interactionHandlers.onFocus}
              onPointerDown={interactionHandlers.onPointerDown}
              onPointerEnter={interactionHandlers.onPointerEnter}
              type="button"
            >
              <div className="verdict-quadrant-meta">
                <span>
                  {voteCount(quadrant.zone)} {pick(language, "VOTES", "票")}
                </span>
                <b>{pick(language, quadrant.note[0], quadrant.note[1])}</b>
              </div>
              <h3>{pick(language, quadrant.label[0], quadrant.label[1])}</h3>
              <p>{pick(language, quadrant.body[0], quadrant.body[1])}</p>
            </button>
          );
        })}

        <div
          className="verdict-field-center"
          data-tone={activeQuadrant?.tone}
          data-verdict-center=""
        >
          <span>
            {activeQuadrant
              ? selectedZone === activeZone
                ? pick(language, "YOUR ONLY VOTE", "你的唯一一票")
                : pick(language, "PREVIEW", "预览")
              : pick(language, "CAST YOUR VOTE", "投下你的选择")}
          </span>
          <i aria-hidden="true" />
          <strong>
            {activeZone
              ? `${voteCount(activeZone)} / ${totalVotes}`
              : totalVotes}
            <small>
              {activeQuadrant
                ? pick(
                    language,
                    activeQuadrant.label[0],
                    activeQuadrant.label[1],
                  )
                : pick(language, "CHOOSE A VERDICT", "选择一个结论")}
            </small>
          </strong>
        </div>
      </div>
    </div>
  );
}
