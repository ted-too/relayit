import * as dns from "node:dns";

const TRAILING_DOT_REGEX = /\.$/;

const isDnsNotFound = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOTFOUND" ||
    code === "ENODATA" ||
    code === "DNS_ENOTFOUND" ||
    code === "DNS_ENODATA"
  );
};

export const lookupTxtRecords = async (host: string): Promise<string[][]> => {
  try {
    return await dns.promises.resolveTxt(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
};

export const lookupCname = async (host: string): Promise<string | null> => {
  try {
    const records = await dns.promises.resolveCname(host);
    return records[0] ?? null;
  } catch (error) {
    if (isDnsNotFound(error)) {
      return null;
    }
    throw error;
  }
};

export const lookupMxRecords = async (
  host: string
): Promise<{ exchange: string; priority: number }[]> => {
  try {
    return await dns.promises.resolveMx(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
};

export const lookupNsRecords = async (host: string): Promise<string[]> => {
  try {
    return await dns.promises.resolveNs(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
};

export const lookupAuthoritativeNameservers = async (
  fqdn: string
): Promise<string[]> => {
  const labels = fqdn.toLowerCase().split(".");

  for (let index = 0; index < labels.length - 1; index += 1) {
    const host = labels.slice(index).join(".");
    const records = await lookupNsRecords(host);
    if (records.length > 0) {
      return records;
    }
  }

  return [];
};

export const txtRecordsIncludeValue = (
  records: string[][],
  expected: string
): boolean => {
  const normalizedExpected = expected.replace(/^"|"$/g, "");
  const matchesJoined = (joined: string) =>
    joined === expected ||
    joined === normalizedExpected ||
    joined.includes(normalizedExpected);

  if (records.some((chunks) => matchesJoined(chunks.join("")))) {
    return true;
  }

  return matchesJoined(records.map((chunks) => chunks.join("")).join(""));
};

export const recordMatchesLiveDns = async (record: {
  readonly name: string;
  readonly recordType: string;
  readonly value: string;
}): Promise<boolean> => {
  switch (record.recordType) {
    case "CNAME": {
      const seen = await lookupCname(record.name);
      if (!seen) {
        return false;
      }
      return (
        seen === record.value ||
        seen.endsWith(`.${record.value}`) ||
        record.value.endsWith(`.${seen}`)
      );
    }
    case "TXT": {
      const txtRecords = await lookupTxtRecords(record.name);
      return txtRecordsIncludeValue(txtRecords, record.value);
    }
    case "MX": {
      const mxRecords = await lookupMxRecords(record.name);
      const normalizedExpected = record.value.replace(TRAILING_DOT_REGEX, "");
      return mxRecords.some((mx) => {
        const exchange = mx.exchange.replace(TRAILING_DOT_REGEX, "");
        return (
          exchange === normalizedExpected ||
          exchange.endsWith(`.${normalizedExpected}`) ||
          normalizedExpected.endsWith(`.${exchange}`)
        );
      });
    }
    default:
      return false;
  }
};
