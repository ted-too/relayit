interface ContactListCursor {
  createdAt: string;
  id: string;
}

export function encodeContactCursor(contact: {
  createdAt: Date;
  id: string;
}): string {
  const payload: ContactListCursor = {
    createdAt: contact.createdAt.toISOString(),
    id: contact.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeContactCursor(cursor: string): ContactListCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<ContactListCursor>;

    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return null;
    }

    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
