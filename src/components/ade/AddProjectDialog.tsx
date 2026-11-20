import { useNavigate } from "@tanstack/react-router";
import { AddProjectForm } from "@/components/ade/AddProjectForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AddProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,40rem)] max-w-xl flex-col gap-0 overflow-hidden border-line bg-paper p-0 sm:rounded-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>Point ADE at a local folder on this machine.</DialogDescription>
        </DialogHeader>
        <AddProjectForm
          onCancel={() => onOpenChange(false)}
          onDone={(projectId) => {
            onOpenChange(false);
            void navigate({
              to: "/p/$projectId/conversations",
              params: { projectId },
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
