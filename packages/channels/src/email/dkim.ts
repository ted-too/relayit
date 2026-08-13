import { generateKeyPairSync, randomBytes } from "node:crypto";
import { formatTxtRecordContent } from "./managed-dns";

const PEM_HEADER_REGEX = /-----BEGIN [^-]+-----/;
const PEM_FOOTER_REGEX = /-----END [^-]+-----/;
const WHITESPACE_REGEX = /\s/g;

export interface DkimKeypair {
  readonly privateKey: string;
  readonly publicKeyDns: string;
  readonly selector: string;
}

export interface DomainKeyMaterial {
  readonly dkimPrivateKey: string;
  readonly dkimPublicKey: string;
  readonly dkimSelector: string;
}

/** Generate a BYODKIM RSA-2048 keypair and DNS-ready public key fragment. */
export const generateDkimKeypair = (): DkimKeypair => {
  const selector = `relayit${randomBytes(4).toString("hex")}`;

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const publicKeyBase64 = publicKey
    .replace(PEM_HEADER_REGEX, "")
    .replace(PEM_FOOTER_REGEX, "")
    .replace(WHITESPACE_REGEX, "");

  return {
    privateKey: privateKey.toString("base64"),
    publicKeyDns: `v=DKIM1; k=rsa; p=${publicKeyBase64}`,
    selector,
  };
};

export const createDomainKeyMaterial = (): DomainKeyMaterial => {
  const keypair = generateDkimKeypair();
  return {
    dkimPrivateKey: keypair.privateKey,
    dkimPublicKey: keypair.publicKeyDns,
    dkimSelector: keypair.selector,
  };
};

export const dkimRecordName = (selector: string, fqdn: string): string =>
  `${selector}._domainkey.${fqdn}`;

export const formatDkimTxtRecord = (publicKeyDns: string): string =>
  formatTxtRecordContent(publicKeyDns);
