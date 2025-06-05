import { IntegrationExamples } from "@/components/integration-examples";
import {
	ChannelCard,
	type ChannelCardProps,
} from "@/components/supported-channels";
import { siteConfig } from "@/lib/config";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	IconArrowRight,
	IconBrandDiscordFilled,
	IconBrandGithub,
	IconBrandWhatsapp,
	IconCode,
	IconMail,
	IconMessage,
	IconRocket,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import rocket from "../../../public/rocket.png";

const title = "Seamless Notification Delivery";
const description = siteConfig.description;

export const dynamic = "force-static";
export const revalidate = false;

export const metadata: Metadata = {
	title,
	description,
	openGraph: {
		images: [
			{
				url: `/og?title=${encodeURIComponent(
					title,
				)}&description=${encodeURIComponent(description)}`,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		images: [
			{
				url: `/og?title=${encodeURIComponent(
					title,
				)}&description=${encodeURIComponent(description)}`,
			},
		],
	},
};

// Define the supported channels data
const supportedChannels: ChannelCardProps[] = [
	{
		name: "Email",
		description: "Transactional & marketing emails",
		status: "live",
		Icon: IconMail,
		providers: ["AWS SES", "Mailgun", "SendGrid", "Postmark", "Sendinblue"],
		className: {
			iconContainer: "bg-secondary",
			icon: "text-secondary-foreground",
		},
	},
	{
		name: "SMS",
		description: "Global SMS delivery",
		status: "live",
		Icon: IconMessage,
		providers: ["AWS SNS", "Twilio", "Nexmo", "Plivo", "Sinch"],
		className: {
			iconContainer: "bg-secondary",
			icon: "text-secondary-foreground",
		},
	},
	{
		name: "WhatsApp",
		description: "Rich messaging & media",
		status: "coming-soon",
		Icon: IconBrandWhatsapp,
		providers: ["WhatsApp Business"],
		className: {
			iconContainer: "bg-[#075E54]",
		},
	},
	{
		name: "Discord",
		description: "Community notifications",
		status: "coming-soon",
		Icon: IconBrandDiscordFilled,
		providers: ["Discord Bot"],
		className: {
			iconContainer: "bg-[#5865F2]",
		},
	},
];

export default function Home() {
	return (
		<div
			data-slot="landing"
			className="flex items-stretch text-[1.05rem] sm:text-[15px] xl:w-full"
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="h-(--top-spacing) shrink-0" />
				<div className="mx-auto flex w-full min-w-0 flex-1 flex-col items-center px-4 py-6 md:px-0 lg:py-8">
					<div className="container flex flex-col items-center gap-2 py-8 text-center md:py-16 lg:py-20 xl:gap-4">
						<h1 className="leading-tighter max-w-3xl text-accent-foreground text-4xl font-semibold tracking-tight text-balance lg:leading-[1.1] lg:font-bold font-(family-name:--font-poppins) xl:text-5xl">
							Stop Juggling{" "}
							<span className="text-foreground">Notification APIs</span>
						</h1>
						<p className="text-foreground max-w-3xl text-base text-balance sm:text-lg">
							{siteConfig.description}
						</p>
						<div className="flex items-center gap-4">
							<Button size="lg" variant="brand" asChild>
								<Link href="/docs/deploy">
									Deploy <IconArrowRight />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<Link href="/docs">Documentation</Link>
							</Button>
						</div>
					</div>

					<div className="container w-full flex flex-col items-center gap-8 pb-16 pt-8 md:pb-20 px-4 lg:px-0">
						<div className="text-center">
							<h2 className="text-2xl font-semibold text-accent-foreground mb-3">
								One API, Multiple Providers
							</h2>
							<p className="text-muted-foreground text-base">
								Choose your preferred providers or let RelayIt handle the
								complexity. Automatic failover and intelligent routing included.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 w-full">
							{supportedChannels.map((channel) => (
								<ChannelCard key={channel.name} {...channel} />
							))}
						</div>
					</div>

					<div className="max-w-3xl w-full flex flex-col items-center gap-6 xl:gap-10 pb-8 text-center md:py-16 lg:pb-20">
						<div className="flex flex-col items-center gap-2">
							<div className="flex items-center">
								<h2 className="leading-tighter max-w-3xl text-accent-foreground text-3xl font-semibold tracking-tight text-balance lg:leading-[1.1] lg:font-bold font-(family-name:--font-poppins) xl:text-4xl">
									Get Started in Minutes
								</h2>
								<Image
									src={rocket}
									alt="Integration CTA"
									placeholder="blur"
									className="h-12 w-auto object-contain"
								/>
							</div>
							<p className="text-foreground max-w-3xl text-base text-balance sm:text-lg">
								Three lines of code. One API call. Every notification channel.
								Replace your notification chaos with reliable, trackable
								delivery.
							</p>
						</div>
						<IntegrationExamples />
						<div className="flex items-center gap-4">
							<Button size="lg" asChild>
								<Link href="/docs/deploy">
									Start Building <IconArrowRight />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<Link href="/docs">See Examples</Link>
							</Button>
						</div>
					</div>

					<section className="py-20">
						<div className="container mx-auto px-4 sm:px-6 lg:px-8">
							<div className="max-w-3xl mx-auto text-center">
								<h2 className="text-3xl lg:text-4xl font-bold text-accent-foreground mb-6">
									Stop Managing Multiple APIs
								</h2>
								<p className="text-xl text-foreground mb-8">
									Deploy RelayIt with Docker in under 5 minutes. Replace
									scattered notification code with one reliable API that handles
									retries, failover, and delivery tracking automatically.
								</p>

								<div className="flex flex-col sm:flex-row gap-4 justify-center">
									<Button size="lg" variant="brand" asChild>
										<Link href="/docs/deploy">
											<IconRocket />
											Quick Deploy Guide
										</Link>
									</Button>
									<Button size="lg" variant="outline" asChild>
										<Link href="/docs">
											<IconCode />
											View API Docs
										</Link>
									</Button>
									<Button size="lg" variant="outline" asChild>
										<Link href={siteConfig.links.github}>
											<IconBrandGithub />
											Star on GitHub
										</Link>
									</Button>
								</div>
								<p className="text-sm text-muted-foreground mt-6">
									100% Open Source • Your Infrastructure • Zero Vendor Lock-in
								</p>
							</div>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
