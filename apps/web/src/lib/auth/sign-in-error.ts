/**
 * What the sign-in pages say when better-auth sends the browser back with `?error=<code>`,
 * after GitHub or any other sign-in it handles on the api. The code comes from the URL, so
 * anyone can write one: it is matched, never shown.
 */
export const signInErrorMessage = (code: string) => {
  switch (code) {
    // An account with this email signed up with a password, and better-auth links GitHub to
    // it only once that email is verified.
    case "account_not_linked":
      return "An account with this email already exists. Sign in with your email and password.";
    case "access_denied":
      return "GitHub sign-in was canceled.";
    default:
      return "Sign-in didn't work. Try again, or sign in with your email and password.";
  }
};
