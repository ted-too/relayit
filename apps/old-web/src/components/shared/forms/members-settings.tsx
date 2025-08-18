"use client";

import { MEMBER_ROLES, type MemberRole } from "@repo/shared";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { DropdownMenuItem } from "@repo/ui/components/shadcn/dropdown-menu";
import { useAppForm } from "@repo/ui/components/shadcn/form";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { cn } from "@repo/ui/lib/utils";
import { CopyIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";

const inviteMemberSchema = z.object({
	email: z.string().email("Invalid email address"),
	role: z.enum(MEMBER_ROLES, { required_error: "Role is required" }),
});

const inviteMembersFormSchema = z.object({
	invitations: z
		.array(inviteMemberSchema)
		.min(1, "At least one invitation is required"),
});

type InviteMembersFormValues = z.infer<typeof inviteMembersFormSchema>;

export function InviteMembersForm() {
	const utils = trpc.useUtils();
	const router = useRouter();

	const form = useAppForm({
		defaultValues: {
			invitations: [{ email: "", role: "member" as MemberRole }],
		} as InviteMembersFormValues,
		validators: {
			onSubmit: inviteMembersFormSchema,
		},
		onSubmit: async ({ value }) => {
			const promises = value.invitations.map((invitation) =>
				authClient.organization.inviteMember({
					email: invitation.email,
					role: invitation.role,
				})
			);

			const results = await Promise.allSettled(promises);

			let successCount = 0;
			const errors: string[] = [];

			results.forEach((result, index) => {
				if (result.status === "fulfilled" && !result.value.error) {
					successCount++;
				} else {
					const email = value.invitations[index]?.email;
					const errorReason =
						result.status === "rejected"
							? (result.reason?.message ?? "Unknown error")
							: (result.value.error?.message ?? "Failed to send invite");
					errors.push(`- ${email}: ${errorReason}`);
				}
			});

			if (successCount > 0) {
				toast.success(`${successCount} invitation(s) sent successfully!`);
				await utils.misc.listMembers.invalidate();
				await utils.misc.listOrgInvitations.invalidate();
				// FIXME: Potentially make the parent a client component so we can just invalidate the query
				router.refresh();
				form.reset();
			}

			if (errors.length > 0) {
				toast.error("Some invitations failed to send:", {
					description: errors.join("\n"),
				});
			}
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<Card className="gap-0 pb-0">
				<CardHeader>
					<CardTitle>Invite Members</CardTitle>
				</CardHeader>
				<form.Field mode="array" name="invitations">
					{(field) => (
						<>
							<CardContent className="mt-3 mb-6 grid gap-6">
								{field.state.value.map((_, index) => (
									<div className="flex items-center gap-4" key={index}>
										<form.AppField
											children={(field) => (
												<field.TextField
													className={{
														root: "grow",
													}}
													label="Email Address"
													placeholder="jane@example.com"
													required
													type="email"
												/>
											)}
											name={`invitations[${index}].email`}
										/>
										<div className="flex items-center gap-4">
											<form.AppField
												children={(field) => (
													<field.SelectField
														label="Role"
														options={MEMBER_ROLES.map((role) => ({
															label:
																role.charAt(0).toUpperCase() + role.slice(1),
															value: role,
														}))}
														placeholder="Select Role"
														triggerProps={{
															className: "w-40",
															"aria-required": true,
														}}
													/>
												)}
												name={`invitations[${index}].role`}
											/>
											<Button
												aria-label="Remove invitation"
												className={cn(
													"mt-5.5",
													field.state.value.length === 1 && "invisible"
												)}
												disabled={field.state.value.length === 1}
												onClick={() => field.removeValue(index)}
												size="icon"
												type="button"
												variant="ghost"
											>
												<TrashIcon className="size-4" />
											</Button>
										</div>
									</div>
								))}
								<Button
									className="w-max"
									onClick={() => field.pushValue({ email: "", role: "member" })}
									size="sm"
									type="button"
									variant="secondary"
								>
									<PlusIcon className="mr-2 size-4" />
									Add more
								</Button>
							</CardContent>
						</>
					)}
				</form.Field>
				<CardFooter className="justify-between bg-secondary py-4">
					<CardDescription>
						Invite new members to your household by email address.
					</CardDescription>
					<form.AppForm>
						<form.SubmitButton className="w-36" size="sm">
							Send Invitations
						</form.SubmitButton>
					</form.AppForm>
				</CardFooter>
			</Card>
		</form>
	);
}

export function InviteMembersFormSkeleton() {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-96" />
			</CardHeader>
			<CardContent className="grid gap-6">
				<div className="grid grid-cols-[1fr_auto_auto] items-end gap-4">
					<div className="space-y-2">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-10 w-full" />
					</div>
					<div className="space-y-2">
						<Skeleton className="h-4 w-12" />
						<Skeleton className="h-10 w-40" />
					</div>
					<Skeleton className="h-10 w-10" />
				</div>
				<div>
					<Skeleton className="h-9 w-28" />
				</div>
			</CardContent>
			<CardFooter className="justify-end border-t pt-6">
				<Skeleton className="h-9 w-36" />
			</CardFooter>
		</Card>
	);
}

export function CancelInvitationAction({
	invitationId,
}: {
	invitationId: string;
}) {
	const utils = trpc.useUtils();
	const router = useRouter();

	const handleAction = async () => {
		const { error } = await authClient.organization.cancelInvitation({
			invitationId,
		});

		if (error) {
			return toast.error(error.message);
		}

		toast.success("Invitation cancelled");
		await utils.misc.listOrgInvitations.invalidate();
		// FIXME: Potentially make the parent a client component so we can just invalidate the query
		router.refresh();
	};

	return (
		<DropdownMenuItem onSelect={handleAction} variant="destructive">
			<TrashIcon /> Cancel Invitation
		</DropdownMenuItem>
	);
}

export function CopyInvitationLinkAction({
	invitationId,
}: {
	invitationId: string;
}) {
	const inviteLink = `${process.env.NEXT_PUBLIC_FRONTEND_URL}/auth/accept-invitation/${invitationId}`;

	const handleAction = async () => {
		await navigator.clipboard.writeText(inviteLink);
		toast.success("Invitation link copied to clipboard");
	};

	return (
		<DropdownMenuItem onSelect={handleAction}>
			<CopyIcon /> Copy Link
		</DropdownMenuItem>
	);
}
