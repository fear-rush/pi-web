import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/models/provider-listing";
import { collectProviderListingInputs } from "@/lib/models/provider-listing-runtime";
import { getModelRuntimeWithExtensions } from "@/lib/models/model-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await getModelRuntimeWithExtensions();
  const inputs = await collectProviderListingInputs(modelRuntime);
  const oauthProviders = buildOAuthProviderList(inputs);
  const apiKeyProviders = buildApiKeyProviderList(inputs);
  return Response.json({ providers: oauthProviders, oauthProviders, apiKeyProviders });
}
