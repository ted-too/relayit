import { Button } from "@repo/old-ui/components/shadcn/button";
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
import { IntegrationExamples } from "@/components/integration-examples";
import {
  ChannelCard,
  type ChannelCardProps,
} from "@/components/supported-channels";
import { siteConfig } from "@/lib/config";
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
          title
        )}&description=${encodeURIComponent(description)}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [
      {
        url: `/og?title=${encodeURIComponent(
          title
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
      className="flex items-stretch text-[1.05rem] sm:text-[15px] xl:w-full"
      data-slot="landing"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-(--top-spacing) shrink-0" />
        <div className="mx-auto flex w-full min-w-0 flex-1 flex-col items-center px-4 py-6 md:px-0 lg:py-8">
          <div className="container flex flex-col items-center gap-2 py-8 text-center md:py-16 lg:py-20 xl:gap-4">
            <h1 className="font-(family-name:--font-poppins) max-w-3xl text-balance font-semibold text-4xl text-accent-foreground leading-tighter tracking-tight lg:font-bold lg:leading-[1.1] xl:text-5xl">
              Stop Juggling{" "}
              <span className="text-foreground">Notification APIs</span>
            </h1>
            <p className="max-w-3xl text-balance text-base text-foreground sm:text-lg">
              {siteConfig.description}
            </p>
            <div className="flex items-center gap-4">
              <Button asChild size="lg" variant="brand">
                <Link href="/docs/deploy">
                  Deploy <IconArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/docs">Documentation</Link>
              </Button>
            </div>
          </div>

          <div className="container flex w-full flex-col items-center gap-8 px-4 pt-8 pb-16 md:pb-20 lg:px-0">
            <div className="text-center">
              <h2 className="mb-3 font-semibold text-2xl text-accent-foreground">
                One API, Multiple Providers
              </h2>
              <p className="text-base text-muted-foreground">
                Choose your preferred providers or let RelayIt handle the
                complexity. Automatic failover and intelligent routing included.
              </p>
            </div>

            <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {supportedChannels.map((channel) => (
                <ChannelCard key={channel.name} {...channel} />
              ))}
            </div>
          </div>

          <div className="flex w-full max-w-3xl flex-col items-center gap-6 pb-8 text-center md:py-16 lg:pb-20 xl:gap-10">
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center">
                <h2 className="font-(family-name:--font-poppins) max-w-3xl text-balance font-semibold text-3xl text-accent-foreground leading-tighter tracking-tight lg:font-bold lg:leading-[1.1] xl:text-4xl">
                  Get Started in Minutes
                </h2>
                <Image
                  alt="Integration CTA"
                  className="h-12 w-auto object-contain"
                  placeholder="blur"
                  src={rocket}
                />
              </div>
              <p className="max-w-3xl text-balance text-base text-foreground sm:text-lg">
                Three lines of code. One API call. Every notification channel.
                Replace your notification chaos with reliable, trackable
                delivery.
              </p>
            </div>
            <IntegrationExamples />
            <div className="flex items-center gap-4">
              <Button asChild size="lg">
                <Link href="/docs/deploy">
                  Start Building <IconArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/docs">See Examples</Link>
              </Button>
            </div>
          </div>

          <section className="py-20">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-3xl text-center">
                <h2 className="mb-6 font-bold text-3xl text-accent-foreground lg:text-4xl">
                  Stop Managing Multiple APIs
                </h2>
                <p className="mb-8 text-foreground text-xl">
                  Deploy RelayIt with Docker in under 5 minutes. Replace
                  scattered notification code with one reliable API that handles
                  retries, failover, and delivery tracking automatically.
                </p>

                <div className="flex flex-col justify-center gap-4 sm:flex-row">
                  <Button asChild size="lg" variant="brand">
                    <Link href="/docs/deploy">
                      <IconRocket />
                      Quick Deploy Guide
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/docs">
                      <IconCode />
                      View API Docs
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href={siteConfig.links.github}>
                      <IconBrandGithub />
                      Star on GitHub
                    </Link>
                  </Button>
                </div>
                <p className="mt-6 text-muted-foreground text-sm">
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
