"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useAppForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { MEMBER_ROLES, type MemberRole } from "@repo/shared";
import { CopyIcon, PlusIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { trpc } from "@/trpc/client";
import { useRouter } from "next/navigation";

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
				}),
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
			<Card className="pb-0 gap-0">
				<CardHeader>
					<CardTitle>Invite Members</CardTitle>
				</CardHeader>
				<form.Field name="invitations" mode="array">
					{(field) => (
						<>
							<CardContent className="grid gap-6 mb-6 mt-3">
								{field.state.value.map((_, index) => (
									<div key={index} className="flex items-center gap-4">
										<form.AppField
											name={`invitations[${index}].email`}
											children={(field) => (
												<field.TextField
													label="Email Address"
													placeholder="jane@example.com"
													type="email"
													required
													className={{
														root: "grow",
													}}
												/>
											)}
										/>
										<div className="flex items-center gap-4">
											<form.AppField
												name={`invitations[${index}].role`}
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
											/>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className={cn(
													"mt-5.5",
													field.state.value.length === 1 && "invisible",
												)}
												onClick={() => field.removeValue(index)}
												disabled={field.state.value.length === 1}
												aria-label="Remove invitation"
											>
												<TrashIcon className="size-4" />
											</Button>
										</div>
									</div>
								))}
								<Button
									type="button"
									variant="secondary"
									size="sm"
									className="w-max"
									onClick={() => field.pushValue({ email: "", role: "member" })}
								>
									<PlusIcon className="mr-2 size-4" />
									Add more
								</Button>
							</CardContent>
						</>
					)}
				</form.Field>
				<CardFooter className="py-4 bg-secondary justify-between">
					<CardDescription>
						Invite new members to your household by email address.
					</CardDescription>
					<form.AppForm>
						<form.SubmitButton size="sm" className="w-36">
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
				<div className="grid grid-cols-[1fr_auto_auto] gap-4 items-end">
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
			<CardFooter className="border-t pt-6 justify-end">
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
		<DropdownMenuItem variant="destructive" onSelect={handleAction}>
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
