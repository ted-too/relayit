import type { InvitationStatus } from "@repo/db/schema/auth";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@repo/ui/components/shadcn/avatar";
import { Badge } from "@repo/ui/components/shadcn/badge";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/shadcn/tabs";
import { getInitials } from "@repo/ui/lib/utils";
import { MoreHorizontalIcon } from "lucide-react";
import {
	CancelInvitationAction,
	CopyInvitationLinkAction,
	InviteMembersForm,
} from "@/components/shared/forms/members-settings";
import type { Organization } from "@/lib/auth-client";

type Member = {
	id: string;
	user: {
		name: string;
		email: string;
		id: string;
		image: string | null;
	};
};

type Invitation = {
	expiresAt: Date;
	organizationId: string;
	role: string | null;
	status: InvitationStatus;
	inviterId: string;
	email: string;
	id: string;
	inviter: {
		name: string;
		id: string;
	};
};

type MembersSettingsProps = {
	organization: Organization;
	members: Member[];
	invitations: Invitation[];
};

export function MembersSettings({
	members,
	invitations,
}: MembersSettingsProps) {
	return (
		<>
			<Card className="max-w-none">
				<CardHeader>
					<CardTitle
						className="text-2xl leading-none tracking-tight"
						id="members"
					>
						Members
					</CardTitle>
					<CardDescription className="text-sm">
						Manage your organization members
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="members">
						<TabsList>
							<TabsTrigger value="members">Members</TabsTrigger>
							<TabsTrigger value="pending">Pending Invitations</TabsTrigger>
						</TabsList>
						<TabsContent className="mt-2" value="members">
							<div className="grid gap-4">
								{members.map((member) => (
									<Card
										className="flex flex-row items-center p-2"
										key={member.id}
									>
										<div
											className="flex h-full grow items-center gap-4"
											data-slot="card-header"
										>
											<Avatar>
												<AvatarImage
													alt={member.user.name}
													src={member.user.image ?? ""}
												/>
												<AvatarFallback>
													{getInitials(member.user.name)}
												</AvatarFallback>
											</Avatar>
											<CardTitle>{member.user.name}</CardTitle>
											<span className="text-muted-foreground text-sm">
												{member.user.email}
											</span>
										</div>
										{/* <CardAction>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon" className="size-8">
											<MoreHorizontalIcon className="size-4" />
											<span className="sr-only">Actions</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
									</DropdownMenuContent>
								</DropdownMenu>
							</CardAction> */}
									</Card>
								))}
							</div>
						</TabsContent>
						<TabsContent className="mt-2" value="pending">
							<div className="grid gap-4">
								{invitations.map((invitation) => (
									<Card
										className="flex flex-row items-center gap-4 p-2"
										key={invitation.id}
									>
										<div
											className="flex h-full w-full grow items-center gap-4"
											data-slot="card-header"
										>
											<Badge
												className="rounded-md px-2 py-1 text-xs"
												variant={
													invitation.status === "rejected"
														? "destructive"
														: "secondary"
												}
											>
												{invitation.status}
											</Badge>
											<CardTitle className="text-sm">
												{invitation.email}
											</CardTitle>
											<span className="ml-auto text-muted-foreground text-sm">
												Invited by {invitation.inviter.name}
											</span>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button className="size-8" size="icon" variant="ghost">
													<MoreHorizontalIcon className="size-4" />
													<span className="sr-only">Actions</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<CopyInvitationLinkAction
													invitationId={invitation.id}
												/>
												<DropdownMenuSeparator />
												<CancelInvitationAction invitationId={invitation.id} />
											</DropdownMenuContent>
										</DropdownMenu>
									</Card>
								))}
							</div>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
			<InviteMembersForm />
		</>
	);
}
