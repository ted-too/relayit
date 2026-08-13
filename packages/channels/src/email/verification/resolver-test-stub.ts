import { spyOn } from "bun:test";
import * as dns from "node:dns";

const TRAILING_DOT_REGEX = /\.$/;

const notFound = (host: string, code = "ENOTFOUND") =>
  Object.assign(new Error(`not found: ${host}`), { code });

const normalizeHost = (host: string) =>
  host.replace(TRAILING_DOT_REGEX, "").toLowerCase();

/** Stub `dns.promises.Resolver` so tests don't hit the ambient resolver. */
export const stubResolverNs = (nsByHost: Record<string, string[]>) => {
  spyOn(dns.promises, "Resolver").mockImplementation(
    (() =>
      ({
        resolve4: () => Promise.resolve(["192.0.2.53"]),
        resolve6: () => Promise.resolve([]),
        resolveCname: () => Promise.reject(notFound("cname", "ENODATA")),
        resolveMx: () => Promise.resolve([]),
        resolveNs: (host: string) => {
          const records = nsByHost[normalizeHost(host)];
          if (records && records.length > 0) {
            return Promise.resolve(records);
          }
          return Promise.reject(notFound(host, "ENODATA"));
        },
        resolveTxt: () => Promise.resolve([]),
        setServers: () => undefined,
      }) as unknown as dns.promises.Resolver) as never
  );
};
