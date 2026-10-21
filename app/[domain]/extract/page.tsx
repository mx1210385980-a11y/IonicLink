import { Extractor } from "@/components/Extractor";
import { isAppAuthEnabled, requireAppPageSession, sessionHasAdminRole } from "@/lib/auth.server";
import { DEFAULT_DOMAIN, isDomain, type Domain } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function ExtractPage({ params }: { params: { domain: string } }) {
  const domain: Domain = isDomain(params.domain) ? params.domain : DEFAULT_DOMAIN;
  // Extraction requires a signed-in account (student or administrator).
  const session = await requireAppPageSession(`/${domain}/extract`);
  const canModerate = !isAppAuthEnabled() || sessionHasAdminRole(session);
  return (
    <div className="-mx-2 -mb-6 -mt-3 sm:-mx-4 lg:mx-0 lg:mb-0 lg:mt-0">
      <Extractor domain={domain} canModerate={canModerate} />
    </div>
  );
}
