// Reviewed, deterministic Extension. It receives values and cannot access storage or permissions.
export const serverPowerManifest = {
  name: "server-power-rules",
  versions: ["1.0.0", "1.1.0"],
  contract: "power-check/1",
} as const;

export function evaluateServerPower(input: {
  version: string;
  enabled: boolean;
  voltage: number;
  outputW: number;
  minOutputW: number;
  proposal?: { voltage: number; outputW: number };
}): { result: "passed" | "failed" | "unknown"; reasons: string[] } {
  if (
    !input.enabled ||
    !input.proposal ||
    !serverPowerManifest.versions.some((version) => version === input.version)
  )
    return {
      result: "unknown",
      reasons: ["전원 규칙 또는 제안 근거가 없습니다."],
    };
  const reasons: string[] = [];
  if (input.proposal.voltage !== input.voltage)
    reasons.push("요구 입력 전압과 일치하지 않습니다.");
  if (input.proposal.outputW < Math.max(input.outputW, input.minOutputW))
    reasons.push("요구 출력에 미달합니다.");
  return { result: reasons.length ? "failed" : "passed", reasons };
}
