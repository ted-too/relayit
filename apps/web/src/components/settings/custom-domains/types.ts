import type { ApiClient, InferData } from "@/integrations/api";

export type Domain = InferData<
  ReturnType<ApiClient["projects"]>["channels"]["email"]["domains"]["get"]
>[number];

export type DNSRecord =
  | Domain["dnsRecords"]["dkimAndSpf"][number]
  | Domain["dnsRecords"]["ownership"][number]
  | Domain["dnsRecords"]["dmarc"][number];
