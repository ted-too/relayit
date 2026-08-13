import { describe, expect, test } from "bun:test";
import {
  createDomainKeyMaterial,
  dkimRecordName,
  formatDkimTxtRecord,
} from "./dkim";

describe("dkim helpers", () => {
  test("createDomainKeyMaterial returns selector and keys", () => {
    const material = createDomainKeyMaterial();
    expect(material.dkimSelector.startsWith("relayit")).toBe(true);
    expect(material.dkimPublicKey.startsWith("v=DKIM1; k=rsa; p=")).toBe(true);
    expect(material.dkimPrivateKey.length).toBeGreaterThan(0);
  });

  test("dkimRecordName and formatDkimTxtRecord", () => {
    expect(dkimRecordName("relayitabc", "example.com")).toBe(
      "relayitabc._domainkey.example.com"
    );
    expect(formatDkimTxtRecord("v=DKIM1; k=rsa; p=abc")).toBe(
      '"v=DKIM1; k=rsa; p=abc"'
    );
  });
});
