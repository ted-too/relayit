// "use client";

// import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { Button } from "@/components/ui/button";
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { authClient } from "@/lib/auth-client";
// import { getInitials } from "@/lib/utils";
// import {
// 	sessionQueryOptions,
// 	singleInvitationQueryOptions,
// } from "@/trpc/queries/user";
// import { useQuery } from "@tanstack/react-query";
// import { notFound, useRouter } from "next/navigation";
// import { toast } from "sonner";
// import { SignInForm } from "./sign-in";
// import { SignUpForm } from "./sign-up";

// export function AcceptInvitation({ pathname }: { pathname: string[] }) {
// 	const router = useRouter();
// 	const invitationId = pathname[1];

// 	const { data: invitation, isPending: isInvitationPending } = useQuery(
// 		singleInvitationQueryOptions(invitationId),
// 	);

// 	const { data: session, isPending: isUserPending } = useQuery(
// 		sessionQueryOptions(),
// 	);

// 	const handleAcceptInvitation = async () => {
// 		if (!invitation) return;

// 		const { data, error } = await authClient.organization.acceptInvitation({
// 			invitationId,
// 		});

// 		if (error) return toast.error(error.message);

// 		toast.success("Invitation accepted");

// 		router.push(`/~/${invitation.organization.slug}`);
// 	};

// 	if (!invitationId) throw notFound();

// 	if (isInvitationPending || isUserPending) return <div>Loading...</div>;

// 	return (
// 		<div className="relative grow flex flex-col gap-6 items-center justify-center w-full h-full">
// 			<div className="flex flex-col gap-2 items-center">
// 				<h1 className="text-2xl font-bold mb-1 text-center">
// 					Accept Invitation
// 				</h1>
// 				<div className="flex items-center gap-4">
// 					<Avatar className="size-10">
// 						<AvatarImage
// 							src={invitation?.organization.logo ?? ""}
// 							alt={invitation?.organization.name}
// 						/>
// 						<AvatarFallback className="text-xs">
// 							{getInitials(invitation?.organization.name ?? "")}
// 						</AvatarFallback>
// 					</Avatar>
// 					<span className="font-medium">{invitation?.organization.name}</span>
// 				</div>
// 			</div>
// 			{session ? (
// 				<div className="flex flex-col gap-4">
// 					<p>
// 						You are already signed in as
// 						<span className="font-medium">{session.user.email}</span>.
// 					</p>
// 					<Button onClick={handleAcceptInvitation}>Accept Invitation</Button>
// 				</div>
// 			) : (
// 				<Tabs defaultValue="sign-in" className="w-[400px]">
// 					<TabsList className="mx-auto">
// 						<TabsTrigger value="sign-in">Sign In</TabsTrigger>
// 						<TabsTrigger value="sign-up">Sign Up</TabsTrigger>
// 					</TabsList>
// 					<TabsContent value="sign-in" className="min-h-[450px] mt-2">
// 						<SignInForm
// 							onSuccess={handleAcceptInvitation}
// 							noTitle
// 							noDescription
// 						/>
// 					</TabsContent>
// 					<TabsContent value="sign-up" className="min-h-[450px] mt-2">
// 						<SignUpForm
// 							onSuccess={handleAcceptInvitation}
// 							email={invitation?.email}
// 							noTitle
// 							noDescription
// 						/>
// 					</TabsContent>
// 				</Tabs>
// 			)}
// 		</div>
// 	);
// }
