import Image, { type StaticImageData } from "next/image";
import { notFound, redirect } from "next/navigation";
import { SignIn } from "./sign-in";
import { SignUp } from "./sign-up";
import { FinishSocialSignUp } from "./finish";
import { sessionQueryOptions } from "@/qc/queries/base";
import type { Session, User } from "@/lib/auth-client";
import { getQueryClient } from "@/qc/client";
import { headers } from "next/headers";
import authImage1 from "../../../../public/auth-1.svg";
import authImage2 from "../../../../public/auth-2.svg";
import authImage3 from "../../../../public/auth-3.svg";
import { SetupOrganization } from "./setup-organization";

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
}: { params: Promise<{ pathname: string[] }> }) {
	const { pathname } = await params;

	const path = pathname.join("/");

	const pageData = PATHS.find(({ pathname: p, catchAll }) =>
		catchAll ? path.startsWith(p) : p === path,
	);

	if (!pageData) throw notFound();

	const queryClient = getQueryClient();

	let session: Session | undefined;

	try {
		session = await queryClient.ensureQueryData(
			sessionQueryOptions({ headers: await headers() }),
		);
	} catch (error) {
		if (!authPathnames.includes(pageData.pathname))
			throw redirect("/auth/sign-in");
	}

	if (!session && !authPathnames.includes(pageData.pathname))
		throw redirect("/auth/sign-in");

	if (session && authPathnames.includes(pageData.pathname))
		throw redirect("/auth/select-household");

	return (
		<div className="h-svh w-full flex flex-col md:flex-row items-center justify-between p-4 md:p-8 gap-8">
			<div className="relative hidden lg:block md:h-full rounded-2xl md:w-[48svw] shrink-0 overflow-hidden">
				<Image
					src={pageData.image}
					className="object-cover size-full"
					alt="Auth background"
				/>
				<a
					href={pageData.imageCredit.href}
					className="absolute bottom-6 right-6 text-white/60 text-sm font-light z-20 hover:underline"
					target="_blank"
					rel="noreferrer"
				>
					{pageData.imageCredit.author}
				</a>
			</div>
			<pageData.component pathname={pathname} initialData={session?.user} />
		</div>
	);
}
