/** Content-addressed object id (sha256 hex). */
export function hashObject(type: string, content: Uint8Array): string {
  const header = new TextEncoder().encode(`${type} ${content.byteLength}\0`);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(header);
  hasher.update(content);
  return hasher.digest("hex");
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
