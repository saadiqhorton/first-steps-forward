import { AgentsPanel } from "@/components/ade/AgentsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AgentsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-line bg-paper p-0 sm:rounded-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Agents & accounts</DialogTitle>
          <DialogDescription>
            Local CLI detection, sign-in status, and default agent per project.
          </DialogDescription>
        </DialogHeader>
        <AgentsPanel />
      </DialogContent>
    </Dialog>
  );
}
