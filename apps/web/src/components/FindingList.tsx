import { localizeText, pick, type Language } from "@/lib/i18n";
import type { RiskFinding } from "@/lib/types";
import { SEVERITY_LABEL, SeverityDot } from "./Indicators";

export function FindingList({
  findings,
  language,
}: {
  findings: RiskFinding[];
  language: Language;
}) {
  if (findings.length === 0) {
    return (
      <div className="text-[12.5px] text-faint">
        {pick(language, "No risk findings identified.", "未识别到风险项。")}
      </div>
    );
  }

  return (
    <div>
      {findings.map((finding) => (
        <div
          className="flex gap-2.5 border-t border-line py-2.5 first:border-0"
          key={`${finding.dimension}-${finding.id}`}
        >
          <SeverityDot severity={finding.severity} />
          <div className="flex-1">
            <div className="text-[11.5px] font-bold">
              {localizeText(finding.title, language)}
              <span className="pill ml-2">
                {localizeText(SEVERITY_LABEL[finding.severity], language)}
              </span>
            </div>
            <div className="text-[11px] text-dim">
              {localizeText(finding.detail, language)}
            </div>
            {finding.evidence ? (
              <div className="mt-0.5 font-mono text-[9.5px] text-faint">
                {localizeText(finding.evidence, language)}
              </div>
            ) : null}
          </div>
          <span className="pill ml-auto shrink-0">
            {localizeText(finding.dimension, language)}
          </span>
        </div>
      ))}
    </div>
  );
}
