declare global {
  interface Window {
    readonly RELAYIT_CONFIG?: { readonly apiUrl?: string };
  }
}

/**
 * The api's origin, which every call goes to with the session cookie. `/config.js` sets it
 * before the app loads: the image's nginx writes it from `API_URL` when the container
 * starts (`nginx/default.conf.template`), and Vite's dev server the same way
 * (`vite.config.ts`), so no deployment's URL is in the build.
 */
export const API_ORIGIN = (() => {
  const apiUrl = window.RELAYIT_CONFIG?.apiUrl;
  if (!apiUrl) {
    throw new Error("/config.js did not say where the api is: is API_URL set on the dashboard?");
  }
  return new URL(apiUrl).origin;
})();
