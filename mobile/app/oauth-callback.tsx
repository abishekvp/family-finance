import { Redirect } from "expo-router";

// familyfinance://oauth-callback is consumed by WebBrowser.openAuthSessionAsync in AuthContext, but
// Android also hands the deep link to the router. Land on the home route instead of "Unmatched route".
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
