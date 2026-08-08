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
  shortLabel: readonly [string, string];
  body: readonly [string, string];
  chineseLabelLines?: readonly [string, string];
};

const QUADRANTS: VerdictQuadrant[] = [
  {
    index: "04",
    zone: "northwest",
    tone: "evidence",
    label: ["MORE EVIDENCE IS REQUIRED", "需要更多证据"],
    note: ["UNKNOWN / DEMO", "UNKNOWN／演示"],
    shortLabel: ["UNKNOWN", "未知"],
    body: [
      "Parallax could not reach a transaction conclusion because required evidence is missing or incomplete.",
      "由于必要证据缺失或不完整，Parallax 无法形成交易结论。",
    ],
  },
  {
    index: "01",
    zone: "northeast",
    tone: "ready",
    label: ["NO BLOCKING EVIDENCE FOUND", "未发现阻断证据"],
    note: ["PROCEED / DEMO", "PROCEED／演示"],
    shortLabel: ["PROCEED", "继续"],
    body: [
      "No blocking evidence was found within the checked demo scope. This is not a safety guarantee.",
      "在已检查的演示范围内未发现阻断证据。这不构成安全保证。",
    ],
  },
  {
    index: "03",
    zone: "southwest",
    tone: "blocked",
    label: ["DO NOT USE THIS TRANSACTION PATH", "请勿使用当前交易路径"],
    chineseLabelLines: ["请勿使用当前", "交易路径"],
    note: ["STOP / DEMO", "STOP／演示"],
    shortLabel: ["STOP", "停止"],
    body: [
      "Blocking evidence applies to this transaction Intent or path. Review the checked reason before continuing.",
      "阻断证据适用于当前交易意图或路径。继续之前请查看已检查的原因。",
    ],
  },
  {
    index: "02",
    zone: "southeast",
    tone: "rerun",
    label: ["ADJUST BEFORE PROCEEDING", "调整后再继续"],
    note: ["ADJUST / DEMO", "ADJUST／演示"],
    shortLabel: ["ADJUST", "调整"],
    body: [
      "When a verified transaction adjustment is available, review the evidence and rerun after making that one change.",
      "当存在经过验证的交易调整时，请查看证据，只修改该项条件后重新运行。",
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
    onPointerEnter: (event: VerdictPointerEvent) => {
      if (event.pointerType !== "touch") previewZone(zone);
    },
  };
}

export function getSelectedVoteStatus(language: Language, compact = false) {
  if (compact) return pick(language, "YOUR VOTE", "你的唯一一票");
  return pick(language, "YOUR ONLY VOTE", "你的唯一一票");
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
              onPointerEnter={interactionHandlers.onPointerEnter}
              type="button"
            >
              <div className="verdict-quadrant-meta">
                <span>
                  {voteCount(quadrant.zone)} {pick(language, "VOTES", "票")}
                </span>
                <b>{pick(language, quadrant.note[0], quadrant.note[1])}</b>
              </div>
              <h3>
                {language === "zh-CN" && quadrant.chineseLabelLines ? (
                  <>
                    <span className="sr-only">{quadrant.label[1]}</span>
                    {quadrant.chineseLabelLines.map((line) => (
                      <span
                        aria-hidden="true"
                        className="verdict-heading-zh-line"
                        key={line}
                      >
                        {line}
                      </span>
                    ))}
                  </>
                ) : (
                  pick(language, quadrant.label[0], quadrant.label[1])
                )}
              </h3>
              <p>{pick(language, quadrant.body[0], quadrant.body[1])}</p>
            </button>
          );
        })}

        <div
          className="verdict-field-center"
          data-tone={activeQuadrant?.tone}
          data-verdict-center=""
        >
          <span className="verdict-vote-status">
            {activeQuadrant ? (
              selectedZone === activeZone ? (
                <>
                  <span className="sr-only">
                    {getSelectedVoteStatus(language)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="verdict-vote-status-desktop"
                  >
                    {getSelectedVoteStatus(language)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="verdict-vote-status-mobile"
                  >
                    {getSelectedVoteStatus(language, true)}
                  </span>
                </>
              ) : (
                pick(language, "PREVIEW", "预览")
              )
            ) : (
              pick(language, "CAST YOUR VOTE", "投下你的选择")
            )}
          </span>
          <i aria-hidden="true" />
          <strong>
            {activeZone
              ? `${voteCount(activeZone)} / ${totalVotes}`
              : totalVotes}
            <small className="verdict-center-label-full">
              {activeQuadrant
                ? pick(
                    language,
                    activeQuadrant.label[0],
                    activeQuadrant.label[1],
                  )
                : pick(language, "CHOOSE A VERDICT", "选择一个结论")}
            </small>
            <small aria-hidden="true" className="verdict-center-label-mobile">
              {activeQuadrant
                ? pick(
                    language,
                    activeQuadrant.shortLabel[0],
                    activeQuadrant.shortLabel[1],
                  )
                : pick(language, "CHOOSE", "选择")}
            </small>
          </strong>
        </div>
      </div>
    </div>
  );
}
