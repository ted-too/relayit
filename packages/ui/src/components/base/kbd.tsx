import { mergeProps } from "@base-ui-components/react/merge-props";
import { useRender } from "@base-ui-components/react/use-render";
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

export const kbdVariants = cva(
	"inline-flex items-center justify-center gap-1.5 text-center font-medium text-muted-foreground text-xs tracking-tight shadow-sm",
	{
		variants: {
			variant: {
				default: "bg-accent",
				outline: "bg-background outline outline-border",
				ghost: "bg-transparent shadow-none",
			},
			size: {
				default: "h-6 rounded px-1.5",
				sm: "h-5 rounded-sm px-1",
				lg: "h-7 rounded-md px-2",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	}
);

const KEY_DESCRIPTIONS: Record<string, string> = {
	"⌘": "Command",
	"⇧": "Shift",
	"⌥": "Option",
	"⌃": "Control",
	Ctrl: "Control",
	"⌫": "Backspace",
	"⎋": "Escape",
	"↩": "Return",
	"⇥": "Tab",
	"⌤": "Enter",
	"↑": "Arrow Up",
	"↓": "Arrow Down",
	"←": "Arrow Left",
	"→": "Arrow Right",
	"⇪": "Caps Lock",
	fn: "Function",
	"⌦": "Delete",
	"⇞": "Page Up",
	"⇟": "Page Down",
	"↖": "Home",
	"↘": "End",
	"↕": "Page Up/Down",
	"↔": "Left/Right",
} as const;

// Create reverse lookup: key name -> symbol
const KEY_NAME_TO_SYMBOL: Record<string, string> = Object.fromEntries(
	Object.entries(KEY_DESCRIPTIONS).map(([symbol, name]) => [name, symbol])
);

KEY_NAME_TO_SYMBOL.Meta = "⌘";
KEY_NAME_TO_SYMBOL.Cmd = "⌘";
KEY_NAME_TO_SYMBOL.Alt = "⌥";
KEY_NAME_TO_SYMBOL.Space = "␣";

export type KbdVariants = VariantProps<typeof kbdVariants>;

interface KbdProps extends useRender.ComponentProps<"div">, KbdVariants {}

function Kbd({
	className,
	variant,
	size,
	render = <div />,
	...props
}: KbdProps) {
	const defaultProps = {
		className: cn(kbdVariants({ className, size, variant })),
		"data-slot": "kbd",
	} as const;

	const element = useRender({
		render,
		props: mergeProps<"div">(defaultProps, props),
	});

	return element;
}

interface KbdKeyProps extends useRender.ComponentProps<"span"> {
	title?: string;
}

function KbdKey({
	className,
	render = <span />,
	title: titleProp,
	children,
	...props
}: KbdKeyProps) {
	const keyText = children?.toString() ?? "";
	const title = titleProp ?? KEY_DESCRIPTIONS[keyText] ?? keyText;

	const defaultProps = {
		className: cn(className),
		"data-slot": "kbd-key",
		children,
	} as const;

	const element = useRender({
		render,
		props: mergeProps<"span">(defaultProps, props),
	});

	return (
		<abbr className="no-underline" title={title}>
			{element}
		</abbr>
	);
}

interface KbdSeparatorProps extends useRender.ComponentProps<"span"> {}

function KbdSeparator({
	className,
	children = "+",
	render = <span />,
	...props
}: KbdSeparatorProps) {
	const defaultProps = {
		className: cn("text-muted-foreground", className),
		"data-slot": "kbd-separator",
		children,
	} as const;

	const element = useRender({
		render,
		props: mergeProps<"span">(defaultProps, props),
	});

	return element;
}

interface KbdShortcutProps
	extends useRender.ComponentProps<"div">,
		KbdVariants {
	shortcut: string;
}

function KbdShortcut({
	shortcut,
	className,
	variant,
	size,
	render = <div />,
	...props
}: KbdShortcutProps) {
	// Parse the shortcut string (e.g., "Meta+Shift+K" or "Ctrl+c")
	const keys = shortcut.split("+").map((key) => key.trim());

	// Generate unique keys for React elements
	const keyElements = keys.flatMap((key, index) => {
		// Convert key name to symbol using reverse lookup, fallback to original key
		const displayKey = KEY_NAME_TO_SYMBOL[key] || key;

		const elements = [
			<KbdKey key={`key-${key}-${shortcut.replace(/\+/g, "-")}`}>
				{displayKey}
			</KbdKey>,
		];

		// Add separator if not the last element
		if (index < keys.length - 1) {
			elements.push(
				<KbdSeparator
					key={`sep-after-${key}-${shortcut.replace(/\+/g, "-")}`}
				/>
			);
		}

		return elements;
	});

	const defaultProps = {
		className: cn(kbdVariants({ className, size, variant })),
		"data-slot": "kbd",
		children: keyElements,
	} as const;

	const element = useRender({
		render,
		props: mergeProps<"div">(defaultProps, props),
	});

	return element;
}

export { Kbd, KbdKey, KbdSeparator, KbdShortcut };
