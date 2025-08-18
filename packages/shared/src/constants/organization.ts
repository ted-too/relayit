export const ORGANIZATION_LOGO_GRADIENTS = {
	sky: "linear-gradient(to bottom right, #87CEEB, #1E90FF)", // Light Blue to Dodger Blue
	sunset: "linear-gradient(to bottom right, #FF7F50, #FF4500)", // Coral to OrangeRed
	forest: "linear-gradient(to bottom right, #90EE90, #2E8B57)", // Light Green to Sea Green
	grape: "linear-gradient(to bottom right, #DDA0DD, #8A2BE2)", // Plum to Blue Violet
	ocean: "linear-gradient(to bottom right, #40E0D0, #008080)", // Turquoise to Teal
	rose: "linear-gradient(to bottom right, #FFB6C1, #DB7093)", // Light Pink to Pale Violet Red
	sand: "linear-gradient(to bottom right, #F4A460, #D2691E)", // Sandy Brown to Chocolate
	mint: "linear-gradient(to bottom right, #98FB98, #3CB371)", // Pale Green to Medium Sea Green
	steel: "linear-gradient(to bottom right, #B0C4DE, #778899)", // Light Steel Blue to Light Slate Gray
	lava: "linear-gradient(to bottom right, #FF4500, #8B0000)", // Orange Red to Dark Red
	emerald: "linear-gradient(to bottom right, #50C878, #006400)", // Emerald Green to Dark Green
	amethyst: "linear-gradient(to bottom right, #BA55D3, #4B0082)", // Medium Orchid to Indigo
} as const;

export type OrganizationLogoGradientKey =
	keyof typeof ORGANIZATION_LOGO_GRADIENTS;

export function getOrganizationLogoGradient(
	key: OrganizationLogoGradientKey
): string {
	return ORGANIZATION_LOGO_GRADIENTS[key];
}

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
