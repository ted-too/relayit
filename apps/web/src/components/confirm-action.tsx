import { Badge } from "@repo/ui/components/reui/badge";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/ui/coss/alert-dialog";
import { Button, type ButtonProps } from "@repo/ui/components/ui/coss/button";
import { Label } from "@repo/ui/components/ui/coss/label";
import { Input } from "@repo/ui/components/ui/shad/input";
import { type ComponentProps, useState } from "react";

interface ConfirmActionProps {
  children?: React.ReactNode;
  confirm?: {
    text?: string;
    variant?: ButtonProps["variant"];
  };
  description?: string;
  execute: () => Promise<void> | void;
  finalFocus?: React.RefObject<HTMLButtonElement | null>;
  isLoading?: boolean;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
  open?: boolean;
  render?: ComponentProps<typeof AlertDialogTrigger>["render"];
  setOpen?: (open: boolean) => void;
  title?: string;
  verificationText?: string;
}

export function ConfirmAction({
  children,
  execute,
  render = <Button variant="destructive" />,
  title = "Confirm Action",
  description = "Are you sure you want to perform this action?",
  verificationText,
  confirm,
  open: _open,
  setOpen: _setOpen,
  finalFocus,
  isLoading,
  onError,
  onSuccess,
}: ConfirmActionProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [verification, setVerification] = useState("");

  const isOpen = _open ?? internalIsOpen;
  const setIsOpen = _setOpen ?? setInternalIsOpen;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setVerification("");
        }
        setIsOpen(open);
      }}
      open={isOpen}
    >
      {children && (
        <AlertDialogTrigger render={render}>{children}</AlertDialogTrigger>
      )}
      <AlertDialogPopup finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {verificationText && (
          <div className="flex flex-col gap-2 px-6 pb-4">
            <Label htmlFor="verification">
              To confirm, type
              <Badge copyText={verificationText} size="xl" variant="secondary">
                {verificationText}
              </Badge>
              in the box below
            </Label>
            <Input
              id="verification"
              onChange={(event) => setVerification(event.target.value)}
              value={verification}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            className="min-w-24"
            disabled={
              verificationText ? verification !== verificationText : false
            }
            isLoading={isLoading}
            onClick={async () => {
              try {
                await execute();
                onSuccess?.();
                setIsOpen(false);
              } catch (error) {
                onError?.(error as Error);
              }
            }}
            variant={confirm?.variant ?? "destructive"}
          >
            {confirm?.text ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
