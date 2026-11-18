import { z } from "zod";

// zod probes `new Function` as each object schema is defined, to compile its parser; the
// image's Content-Security-Policy refuses it and the browser reports a violation, then zod
// parses without. Telling it up front skips the probe. `main.tsx` imports this first.
z.config({ jitless: true });
