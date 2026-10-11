import { Extractor } from "@/components/Extractor";
import { DEFAULT_DOMAIN, isDomain, type Domain } from "@/lib/domain";

export default function ExtractPage({ params }: { params: { domain: string } }) {
  const domain: Domain = isDomain(params.domain) ? params.domain : DEFAULT_DOMAIN;
  return (
    <div className="-mx-2 -mb-6 -mt-3 sm:-mx-4 lg:mx-0 lg:mb-0 lg:mt-0">
      <Extractor domain={domain} />
    </div>
  );
}
