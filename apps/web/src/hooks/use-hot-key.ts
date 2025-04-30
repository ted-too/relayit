import { useEffect, useRef } from "react";

export function useHotKey(
	callback: () => void,
	key: string | string[],
	options: { preventDefault?: boolean } = { preventDefault: false },
): void {
	// Store the latest callback in a ref to avoid dependency issues
	const callbackRef = useRef(callback);

	// Update ref when callback changes
	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	// Store preventDefault option in a ref
	const preventDefaultRef = useRef(options.preventDefault);

	// Update preventDefault ref when it changes
	useEffect(() => {
		preventDefaultRef.current = options.preventDefault;
	}, [options.preventDefault]);

	useEffect(() => {
		// Use a Set to track currently pressed keys
		const pressedKeys = new Set<string>();

		// Normalize the keys to lowercase
		const keys = Array.isArray(key)
			? key.map((k) => k.toLowerCase())
			: [key.toLowerCase()];

		function handleKeyDown(e: KeyboardEvent) {
			const pressedKey = e.key.toLowerCase();
			pressedKeys.add(pressedKey);

			// Map all potential modifier keys
			const modifierMap = {
				meta: e.metaKey,
				ctrl: e.ctrlKey,
				shift: e.shiftKey,
				alt: e.altKey,
			};

			// Determine which modifiers are explicitly required in the key array
			const requiredModifiers = {
				meta: keys.includes("meta"),
				ctrl: keys.includes("ctrl"),
				shift: keys.includes("shift"),
				alt: keys.includes("alt"),
			};

			// For a single key shortcut (not an array), meta or ctrl is required but no other modifiers
			const isSingleKey = !Array.isArray(key);

			// For single key shortcuts - they need meta/ctrl but NO other modifiers (unless it's the "." reset key)
			const singleKeyValid =
				isSingleKey &&
				(e.metaKey || e.ctrlKey) &&
				(!e.shiftKey || keys[0] === ".") &&
				!e.altKey;

			// Get non-modifier keys (the actual letter keys to press)
			const nonModifierKeys = keys.filter(
				(k) => !["meta", "ctrl", "shift", "alt"].includes(k),
			);

			// Check if all required non-modifier keys are pressed
			const allNonModifiersPressed = nonModifierKeys.every((k) =>
				pressedKeys.has(k),
			);

			// For array combinations, adjust the logic:
			// 1. All required modifiers MUST be pressed
			// 2. Additional modifiers are allowed
			const requiredModifiersPressed =
				(!requiredModifiers.meta || modifierMap.meta) &&
				(!requiredModifiers.ctrl || modifierMap.ctrl) &&
				(!requiredModifiers.shift || modifierMap.shift) &&
				(!requiredModifiers.alt || modifierMap.alt);

			// Meta or Ctrl is always needed for key combinations (unless already specified)
			const hasMetaOrCtrl = modifierMap.meta || modifierMap.ctrl;
			const needsMetaOrCtrl =
				!requiredModifiers.meta && !requiredModifiers.ctrl;
			const modifierRequirementMet =
				(needsMetaOrCtrl && hasMetaOrCtrl) || !needsMetaOrCtrl;

			// Valid trigger conditions
			const isHotkeyTriggered =
				(isSingleKey && singleKeyValid && pressedKeys.has(keys[0])) ||
				(!isSingleKey &&
					requiredModifiersPressed &&
					modifierRequirementMet &&
					allNonModifiersPressed);

			if (isHotkeyTriggered) {
				if (preventDefaultRef.current) {
					e.preventDefault();
				}
				callbackRef.current();
			}
		}

		function handleKeyUp(e: KeyboardEvent) {
			const releasedKey = e.key.toLowerCase();
			pressedKeys.delete(releasedKey);

			// Special handling for modifier keys
			if (["meta", "control", "shift", "alt"].includes(releasedKey)) {
				// When modifier is released, clear all tracked keys to avoid stuck states
				pressedKeys.clear();
			}
		}

		// Clear pressed keys when window loses focus
		function handleBlur() {
			pressedKeys.clear();
		}

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		window.addEventListener("blur", handleBlur);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			window.removeEventListener("blur", handleBlur);
		};
	}, [key]); // Only re-create handlers when key changes
}

export function useResetFocus() {
	useHotKey(() => {
		// FIXME: some dedicated div[tabindex="0"] do not auto-unblur (e.g. the DataTableFilterResetButton)
		// REMINDER: we cannot just document.activeElement?.blur(); as the next tab will focus the next element in line,
		// which is not what we want. We want to reset entirely.
		document.body.setAttribute("tabindex", "0");
		document.body.focus();
		document.body.removeAttribute("tabindex");
	}, ".");
}
