import type { BranchKind } from "../../lib/types";

const KIND_COLORS: Record<BranchKind, string> = {
  conversation: "bg-blue-900/60 text-blue-300",
  issue: "bg-red-900/60 text-red-300",
  decision: "bg-amber-900/60 text-amber-300",
  "fix-attempt": "bg-orange-900/60 text-orange-300",
  context: "bg-emerald-900/60 text-emerald-300",
  summary: "bg-purple-900/60 text-purple-300",
  export: "bg-indigo-900/60 text-indigo-300",
};

interface Props {
  kind: BranchKind;
}

export function BranchKindBadge({ kind }: Props) {
  return (
    <span className={`badge ${KIND_COLORS[kind]}`}>
      {kind}
    </span>
  );
}
