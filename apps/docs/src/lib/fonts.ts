import { cn } from "@repo/old-ui/lib/utils";
import {
	Geist_Mono as FontMono,
	Geist as FontSans,
	Inter,
	Poppins,
} from "next/font/google";

const fontSans = FontSans({
	subsets: ["latin"],
	variable: "--font-sans",
});

const fontMono = FontMono({
	subsets: ["latin"],
	variable: "--font-mono",
	weight: ["400"],
});

const fontInter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
});

const fontPoppins = Poppins({
	subsets: ["latin"],
	variable: "--font-poppins",
	weight: ["600", "700"],
});

export const fontVariables = cn(
	fontSans.variable,
	fontMono.variable,
	fontInter.variable,
	fontPoppins.variable
);
