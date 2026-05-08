import type { Branch, TreeNode } from "../../lib/types";
import { useVault } from "../../store/vaultStore";
import { BranchKindBadge } from "../ui/Badge";

function buildTree(branches: Branch[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const b of branches) map.set(b.id, { branch: b, children: [] });

  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const pid = node.branch.parentBranchId;
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function BranchNode({ node, depth }: { node: TreeNode; depth: number }) {
  const { selectedBranchId, selectBranch } = useVault();
  const b = node.branch;
  const isSelected = selectedBranchId === b.id;

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        onClick={() => selectBranch(b.id)}
        className={`w-full text-left flex items-start gap-2 px-3 py-2 rounded-md hover:bg-vault-border/40 transition-colors ${
          isSelected ? "bg-vault-accent/20 border border-vault-accent/40" : ""
        }`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vault-text truncate">{b.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <BranchKindBadge kind={b.kind} />
            <span className="text-xs text-vault-muted">
              {b.rawTokenCount.toLocaleString()} tok
            </span>
            {b.compressedTokenCount != null && (
              <span className="text-xs text-vault-accent">
                → {b.compressedTokenCount.toLocaleString()} compressed
              </span>
            )}
          </div>
        </div>
      </button>
      {node.children.map((child) => (
        <BranchNode key={child.branch.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function BranchTree() {
  const { activeBranches } = useVault();

  if (activeBranches.length === 0) {
    return (
      <div className="p-4 text-vault-muted text-sm text-center">
        Select a conversation to view its branch tree.
      </div>
    );
  }

  const roots = buildTree(activeBranches);
  return (
    <div className="p-2 space-y-1">
      {roots.map((root) => (
        <BranchNode key={root.branch.id} node={root} depth={0} />
      ))}
    </div>
  );
}
