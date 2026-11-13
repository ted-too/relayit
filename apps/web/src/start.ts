import { createStart } from "@tanstack/react-start";

// The dashboard is behind sign-in: routes load in the browser, from the api.
export const startInstance = createStart(() => ({ defaultSsr: false }));
