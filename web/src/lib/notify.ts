// Toasts (Overt Toast: bottom right, full width on phones; errors 8 s, others 5 s; Undo on every undoable change).
import { toast, type ToastData } from "@/components/ui/toast";

export function notify(title: string, opts: { type?: "success" | "error" | "info"; actions?: ToastData["actions"]; timeout?: number; description?: string } = {}) {
  return toast.add<ToastData>({
    title,
    description: opts.description,
    type: opts.type,
    timeout: opts.timeout ?? (opts.type === "error" ? 8000 : opts.actions?.length ? 8000 : 5000),
    priority: opts.type === "error" ? "high" : "low",
    data: { actions: opts.actions },
  });
}
