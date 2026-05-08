import { AlertTriangle } from "lucide-react";

interface Props {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: Props) {
  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      {/* Dialog */}
      <div
        className="w-96 card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="shrink-0 text-red-400 mt-0.5" size={20} />
          <div>
            <h2 className="font-semibold text-vault-text text-sm mb-1">{title}</h2>
            <p className="text-xs text-vault-muted">{body}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
