import { createContext, useCallback, useContext, useState } from "react";

interface ControlsContextType {
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const ControlsContext = createContext<ControlsContextType | null>(null);

export function ControlsProvider({
	children,
	ssrOpen = true,
}: {
	children: React.ReactNode;
	ssrOpen?: boolean;
}) {
	const [_open, _setOpen] = useState(ssrOpen);
	const open = _open;
	const setOpen = useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const openState = typeof value === "function" ? value(open) : value;
			_setOpen(openState);

			// This sets the cookie to keep the controls state.
			document.cookie = `controls-state=${openState}; path=/; max-age=31536000`;
		},
		[open],
	);

	return (
		<ControlsContext.Provider value={{ open, setOpen }}>
			<div
				// REMINDER: access the data-expanded state with tailwind via `group-data-[expanded=true]/controls:block`
				// In tailwindcss v4, we could even use `group-data-expanded/controls:block`
				className="group/controls"
				data-expanded={open}
			>
				{children}
			</div>
		</ControlsContext.Provider>
	);
}

export function useControls() {
	const context = useContext(ControlsContext);

	if (!context) {
		throw new Error("useControls must be used within a ControlsProvider");
	}

	return context as ControlsContextType;
}
