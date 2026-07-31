import type { RiskFinding } from "@/lib/types";
import { SEVERITY_LABEL, SeverityDot } from "./Indicators";

export function FindingList({ findings }: { findings: RiskFinding[] }) {
  if (findings.length === 0) {
    return <div className="text-[12.5px] text-faint">未識別到風險項。</div>;
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
              {finding.title}
              <span className="pill ml-2">{SEVERITY_LABEL[finding.severity]}</span>
            </div>
            <div className="text-[11px] text-dim">{finding.detail}</div>
            {finding.evidence ? (
              <div className="mt-0.5 font-mono text-[9.5px] text-faint">
                {finding.evidence}
              </div>
            ) : null}
          </div>
          <span className="pill ml-auto shrink-0">{finding.dimension}</span>
        </div>
      ))}
    </div>
  );
}
