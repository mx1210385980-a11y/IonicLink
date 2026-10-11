import type { RecordStatus } from "@/lib/schema";

export type DatabasePayload = {
  records: any[];
  counts: { official: number; review: number };
  papers: { title: string; n: number }[];
};

export type DatabaseInitialData = DatabasePayload & {
  status: RecordStatus;
  queryKey: string;
};
