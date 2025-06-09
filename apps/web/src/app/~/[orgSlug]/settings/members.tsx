import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import type { Organization } from "@/lib/auth-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/shadcn/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/shadcn/avatar";
import { Badge } from "@repo/ui/components/shadcn/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu";
import { Button } from "@repo/ui/components/shadcn/button";
import { MoreHorizontalIcon } from "lucide-react";
import {
	CancelInvitationAction,
	CopyInvitationLinkAction,
	InviteMembersForm,
} from "@/components/shared/forms/members-settings";
import { getInitials } from "@repo/ui/lib/utils";
import { Fragment } from "react";
import type { InvitationStatus } from "@repo/db/schema/auth";

interface Member {
	id: string;
	user: {
		name: string;
		email: string;
		id: string;
		image: string | null;
	};
}

interface Invitation {
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
}

interface MembersSettingsProps {
	organization: Organization;
	members: Member[];
	invitations: Invitation[];
}

export function MembersSettings({
	members,
	invitations,
}: MembersSettingsProps) {
	return (
		<Fragment>
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
						<TabsContent value="members" className="mt-2">
							<div className="grid gap-4">
								{members.map((member) => (
									<Card key={member.id} className="flex-row items-center p-2 flex">
										<div
											data-slot="card-header"
											className="grow flex gap-4 items-center h-full"
										>
											<Avatar>
												<AvatarImage
													src={member.user.image ?? ""}
													alt={member.user.name}
												/>
												<AvatarFallback>
													{getInitials(member.user.name)}
												</AvatarFallback>
											</Avatar>
											<CardTitle>{member.user.name}</CardTitle>
											<span className="text-sm text-muted-foreground">
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
						<TabsContent value="pending" className="mt-2">
							<div className="grid gap-4">
								{invitations.map((invitation) => (
									<Card
										key={invitation.id}
										className="flex-row flex items-center p-2 gap-4"
									>
										<div
											data-slot="card-header"
											className="grow flex gap-4 w-full items-center h-full"
										>
											<Badge
												variant={
													invitation.status === "rejected"
														? "destructive"
														: "secondary"
												}
												className="text-xs px-2 py-1 rounded-md"
											>
												{invitation.status}
											</Badge>
											<CardTitle className="text-sm">{invitation.email}</CardTitle>
											<span className="text-sm text-muted-foreground ml-auto">
												Invited by {invitation.inviter.name}
											</span>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="size-8">
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
		</Fragment>
	);
}
