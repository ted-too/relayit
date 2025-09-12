import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/base/alert-dialog";
import { ActionButton, type ButtonProps } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Label } from "@/components/base/label";

interface ConfirmActionProps {
  title?: string;
  description?: string;
  confirm?: string;
  confirmVariant?: ButtonProps["variant"];
  verificationText?: string;
  execute: () => Promise<void> | void;
  isLoading?: boolean;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  children: React.ReactNode;
}

export function ConfirmAction({
  title = "Confirm Action",
  description = "Are you sure you want to perform this action?",
  confirm,
  confirmVariant = "destructive",
  verificationText,
  execute,
  isLoading,
  onSuccess,
  onError,
  children,
}: ConfirmActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [verification, setVerification] = useState("");

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger render={children as any} />
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {verificationText && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="verification">
              To confirm, type "{verificationText}" in the box below
            </Label>
            <Input
              id="verification"
              value={verification}
              onValueChange={setVerification}
              className="bg-secondary shadow-none"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose>Cancel</AlertDialogClose>
          <ActionButton
            isLoading={isLoading}
            variant={confirmVariant}
            disabled={
              verificationText ? verification !== verificationText : false
            }
            className="min-w-24"
            onClick={async () => {
              try {
                await execute();
                onSuccess?.();
                setIsOpen(false);
              } catch (error) {
                onError?.(error as Error);
              }
            }}
          >
            {confirm}
          </ActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
