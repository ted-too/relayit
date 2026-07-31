import { RiCloudLine } from "@remixicon/react";
import { cn } from "@repo/ui/lib/utils";
import {
  AwsAmazonRoute53,
  Cloudflare,
  DigitalOcean,
  Gandi,
  Godaddy,
  Google,
  Hostgator,
  Ionos,
  MicrosoftAzure,
  Namecheap,
  Netlify,
  Ovh,
  Porkbun,
  Shopify,
  Squarespace,
  Vercel,
  Wix,
} from "@thesvg/react";
import { Image } from "@unpic/react";
import type { Domain } from "./types";

function UnknownIcon({ children: _, ...props }: React.SVGProps<SVGSVGElement>) {
  return <RiCloudLine {...props} />;
}

export const DOMAIN_PROVIDER_ICONS = {
  cloudflare: Cloudflare,
  route53: AwsAmazonRoute53,
  google: Google,
  azure: MicrosoftAzure,
  vercel: Vercel,
  dnsimple: (props) => (
    <svg
      clipRule="evenodd"
      fillRule="evenodd"
      strokeLinejoin="round"
      strokeMiterlimit="1.414"
      viewBox="0 0 480 480"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Dnsimple</title>
      <path d="M0 0h480v480H0z" fill="none" />
      <clipPath id="a">
        <path d="M0 0h480v480H0z" />
      </clipPath>
      <g clipPath="url(#a)">
        <circle cx="240" cy="240" fill="#1a5ec6" r="240" />
        <path
          d="M295.77 96.601c-7.908 0-15.815.416-23.306 2.08v77.408c-10.82-4.162-23.305-6.243-39.952-6.243-59.096 0-107.372 40.369-107.372 105.291 0 66.587 44.114 103.21 109.037 103.21 32.045 0 64.922-8.74 85.314-19.56V98.681c-7.907-1.664-16.23-2.08-23.721-2.08zm-62.426 240.545c-35.79 0-60.344-24.138-60.344-62.841 0-38.288 26.218-62.842 61.177-62.842 14.149 0 27.051 1.665 38.287 8.74v110.701c-12.485 4.577-25.386 6.658-39.12 6.242z"
          fill="#fff"
          fillRule="nonzero"
        />
      </g>
    </svg>
  ),
  netlify: Netlify,
  ns1: UnknownIcon,
  digitalocean: DigitalOcean,
  godaddy: Godaddy,
  namecheap: Namecheap,
  hover: (props) => (
    <Image
      className={cn("rounded-full object-cover", props.className)}
      layout="fullWidth"
      src="https://www.hover.com/favicon-96x96.png"
    />
  ),
  porkbun: Porkbun,
  dreamhost: (props) => (
    <svg
      height="2471"
      preserveAspectRatio="xMidYMid"
      viewBox="0 0 256 253"
      width="2500"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>DreamHost</title>
      <path
        d="M252.69 189.792c-20.743 11.573-44.823 17.998-70.423 17.474-75.461-1.519-135.419-62.678-133.94-136.567.53-25.094 8.032-48.384 20.718-68.196C28.643 25.06 1.03 67.243.027 116.07c-1.493 73.9 58.513 135.053 133.995 136.577 49.838 1.013 94.018-24.254 118.668-62.856"
        fill="#1F3244"
      />
      <path
        d="M180.943 191.375c.836.015 1.677.03 2.518.03 19.694 0 39.12-4.877 56.391-14.056 10.178-17.449 16.103-37.701 16.103-59.388C255.955 52.825 203.293 0 138.316 0c-20.485 0-39.739 5.272-56.505 14.506a114.556 114.556 0 0 0-17.236 58.053c-1.285 64.18 50.912 117.495 116.368 118.816"
        fill="#3E95BE"
      />
    </svg>
  ),
  ionos: Ionos,
  ovh: Ovh,
  gandi: Gandi,
  dynadot: (props) => (
    <svg
      fill="none"
      height="104"
      viewBox="0 0 102 104"
      width="102"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Dynadot</title>
      <path
        d="M98.2798 15.7699C91.0598 1.30994 72.8498 -4.12006 58.5098 3.32994L16.0598 25.4099L25.5698 43.6799L15.9798 48.6599C1.77981 56.0399 -4.25019 73.9299 3.22981 88.0799C8.39981 97.8499 18.4398 103.45 28.7998 103.45C33.2798 103.45 37.8298 102.4 42.0798 100.2L85.1098 77.8099L75.6298 59.5599L85.7598 54.2899C99.7398 47.0199 105.29 29.8199 98.2798 15.7799V15.7699ZM37.1398 90.6699C26.8098 96.0399 13.6298 90.4799 10.9398 78.1799C10.6098 76.7099 10.4998 75.1899 10.5898 73.6899C11.0198 66.9899 14.7198 61.3799 20.3898 58.4499L30.5198 53.1799L34.7098 61.2399C39.1398 69.7499 49.6398 73.0699 58.1598 68.6499L66.1198 64.5099L70.6698 73.2599L37.1498 90.6799L37.1398 90.6699ZM52.2098 43.4699C55.4798 44.0899 58.1098 46.7199 58.7398 49.9799C59.8498 55.8299 54.8198 60.8599 48.9698 59.7599C45.6998 59.1399 43.0698 56.4999 42.4398 53.2299C41.3298 47.3799 46.3698 42.3599 52.2098 43.4599V43.4699ZM80.3798 44.9899L70.6798 50.0399L66.4898 41.9899C62.0498 33.4699 51.5498 30.1499 43.0398 34.5799L35.0698 38.7199L30.5198 29.9699L64.0398 12.5499C72.8398 7.97994 83.6898 11.3299 88.3898 20.0099C93.2198 28.9399 89.3798 40.3099 80.3698 44.9999L80.3798 44.9899Z"
        fill="black"
      />
    </svg>
  ),
  namecom: (props) => (
    <svg
      enableBackground="new 0 0 180 180"
      viewBox="0 0 180 180"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Name.com</title>
      <path
        d="m90.1 0c49.7 0 89.9 40.2 89.9 89.9s-40.2 89.9-89.9 89.9-90-40.1-90-89.9c0-49.6 40.3-89.9 90-89.9z"
        fill="#282828"
      />
      <path
        d="m39.1 121.1v-61.4l18-4.3-2.8 19.8h1.9c1.1-4.6 2.9-8.5 5.2-11.6 2.5-3.2 5.5-5.6 9.2-7.2 3.8-1.7 8.2-2.6 13.2-2.6 6.5 0 12.1 1.4 16.8 4.4 4.7 2.9 8.3 7 10.8 12.6 2.6 5.4 3.9 11.9 3.9 19.5v30.8h-17.7v-26.3c0-5.1-.8-9.4-2.3-13-1.6-3.6-3.9-6.3-6.9-8.2-3.1-1.9-6.6-2.9-10.9-2.9-6.3 0-11.3 2-14.9 6.2-3.6 4.1-5.3 10-5.3 17.7v26.4h-18.2z"
        fill="#fff"
      />
      <circle cx="137.3" cy="110.4" fill="#6eda78" r="12.4" />
    </svg>
  ),
  wix: Wix,
  squarespace: Squarespace,
  shopify: Shopify,
  bluehost: (props) => (
    <svg
      height="800px"
      viewBox="0 0 1024 1024"
      width="800px"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Bluehost</title>
      <circle cx="512" cy="512" r="512" style={{ fill: "#0076ff" }} />
      <path
        d="M303.9 303.4h116.2v116.2H303.9V303.4zm149.8 0h116.2v116.2H453.7V303.4zm150.2 0h116.2v116.2H603.9V303.4zm-300 150.5h116.2v116.2H303.9V453.9zm149.8 0h116.2v116.2H453.7V453.9zm150.2 0h116.2v116.2H603.9V453.9zm-300 150.5h116.2v116.2H303.9V604.4zm149.8 0h116.2v116.2H453.7V604.4zm150.2 0h116.2v116.2H603.9V604.4z"
        style={{ fill: "#fff" }}
      />
    </svg>
  ),
  hostgator: Hostgator,
  unknown: UnknownIcon,
} as const satisfies Record<
  Domain["provider"],
  React.ComponentType<React.SVGProps<SVGSVGElement>>
>;
