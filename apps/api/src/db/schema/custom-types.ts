import { gunzipSync, gzipSync } from "node:zlib";
import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{
  data: string;
  driverData: Buffer;
  default: false;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(value: string): Buffer {
    const textBuffer = Buffer.from(value, "utf8");
    return gzipSync(textBuffer);
  },
  fromDriver(value: Buffer): string {
    const decompressed = gunzipSync(value);
    return decompressed.toString("utf8");
  },
});
