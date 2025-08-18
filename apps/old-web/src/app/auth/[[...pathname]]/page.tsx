import { headers } from "next/headers";
import Image, { type StaticImageData } from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Session, User } from "@/lib/auth-client";
import { sessionQueryOptions } from "@/trpc/queries/auth";
import { getQueryClient } from "@/trpc/server";
import authImage1 from "../../../../public/auth-1.svg";
import authImage2 from "../../../../public/auth-2.svg";
import authImage3 from "../../../../public/auth-3.svg";
import { FinishSocialSignUp } from "./finish";
import { SetupOrganization } from "./setup-organization";
import { SignIn } from "./sign-in";
import { SignUp } from "./sign-up";

const authImageCredit = {
	author: "Olli Kilpi",
	href: "https://unsplash.com/@space_parts?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash",
};

const PATHS: {
	pathname: string;
	component: React.ComponentType<{ pathname: string[]; initialData?: User }>;
	image: StaticImageData;
	imageCredit: { author: string; href: string };
	catchAll?: boolean;
}[] = [
	{
		pathname: "sign-in",
		component: SignIn,
		image: authImage1,
		imageCredit: authImageCredit,
	},
	{
		pathname: "sign-up",
		component: SignUp,
		image: authImage2,
		imageCredit: authImageCredit,
	},
	{
		pathname: "finish",
		component: FinishSocialSignUp,
		image: authImage3,
		imageCredit: authImageCredit,
	},
	{
		pathname: "setup-organization",
		// @ts-expect-error - This is just a redirect
		component: SetupOrganization,
		image: authImage3,
		imageCredit: authImageCredit,
	},
	// {
	// 	pathname: "accept-invitation",
	// 	catchAll: true,
	// 	component: AcceptInvitation,
	// 	image: authImage2,
	// 	imageCredit: {
	// 		author: "Naomi Hébert",
	// 		href: "https://unsplash.com/@naomish?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash",
	// 	},
	// },
	// {
	// 	pathname: "select-household",
	// 	component: SelectHousehold,
	// 	image: authImage2,
	// 	imageCredit: {
	// 		author: "Naomi Hébert",
	// 		href: "https://unsplash.com/@naomish?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash",
	// 	},
	// },
];

export function generateStaticParams() {
	return PATHS.map(({ pathname }) => ({ pathname: [pathname] }));
}

const authPathnames = ["sign-in", "sign-up"];

export default async function AuthPage({
	params,
}: {
	params: Promise<{ pathname: string[] }>;
}) {
	const { pathname } = await params;

	const path = pathname.join("/");

	const pageData = PATHS.find(({ pathname: p, catchAll }) =>
		catchAll ? path.startsWith(p) : p === path
	);

	if (!pageData) {
		throw notFound();
	}

	const queryClient = getQueryClient();

	let session: Session | undefined;

	try {
		session = await queryClient.ensureQueryData(
			sessionQueryOptions({ headers: await headers() })
		);
	} catch (_error) {
		if (!authPathnames.includes(pageData.pathname)) {
			throw redirect("/auth/sign-in");
		}
	}

	if (!(session || authPathnames.includes(pageData.pathname))) {
		throw redirect("/auth/sign-in");
	}

	if (session && authPathnames.includes(pageData.pathname)) {
		throw redirect("/auth/setup-organization");
	}

	return (
		<div className="flex h-svh w-full flex-col items-center justify-between gap-8 p-4 md:flex-row md:p-8">
			<div className="relative hidden shrink-0 overflow-hidden rounded-2xl md:h-full md:w-[48svw] lg:block">
				<Image
					alt="Auth background"
					className="size-full object-cover"
					src={pageData.image}
				/>
				<a
					className="absolute right-6 bottom-6 z-20 font-light text-sm text-white/60 hover:underline"
					href={pageData.imageCredit.href}
					rel="noreferrer"
					target="_blank"
				>
					{pageData.imageCredit.author}
				</a>
			</div>
			<pageData.component initialData={session?.user} pathname={pathname} />
		</div>
	);
}
