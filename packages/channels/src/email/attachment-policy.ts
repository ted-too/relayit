/** Delivery-owned attachment object TTL after max(now, scheduledAt). */
export const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max resolved attachment size (SES-aligned). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Attachment URL fetch timeout. */
export const ATTACHMENT_FETCH_TIMEOUT = "30 seconds" as const;

export const ATTACHMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  csv: "text/csv",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  zip: "application/zip",
};

/**
 * Executable / script extensions SES (and others) reject — fail at Accept.
 * https://docs.aws.amazon.com/ses/latest/dg/attachments.html
 */
export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  "ade",
  "adp",
  "app",
  "asp",
  "bas",
  "bat",
  "cer",
  "chm",
  "cmd",
  "com",
  "cpl",
  "crt",
  "csh",
  "der",
  "exe",
  "fxp",
  "gadget",
  "hlp",
  "hta",
  "inf",
  "ins",
  "isp",
  "its",
  "js",
  "jse",
  "ksh",
  "lib",
  "lnk",
  "mad",
  "maf",
  "mag",
  "mam",
  "maq",
  "mar",
  "mas",
  "mat",
  "mau",
  "mav",
  "maw",
  "mda",
  "mdb",
  "mde",
  "mdt",
  "mdw",
  "mdz",
  "msc",
  "msh",
  "msh1",
  "msh2",
  "mshxml",
  "msh1xml",
  "msh2xml",
  "msi",
  "msp",
  "mst",
  "ops",
  "pcd",
  "pif",
  "plg",
  "prf",
  "prg",
  "reg",
  "scf",
  "scr",
  "sct",
  "shb",
  "shs",
  "sys",
  "ps1",
  "ps1xml",
  "ps2",
  "ps2xml",
  "psc1",
  "psc2",
  "tmp",
  "url",
  "vb",
  "vbe",
  "vbs",
  "vps",
  "vsmacros",
  "vss",
  "vst",
  "vsw",
  "vxd",
  "ws",
  "wsc",
  "wsf",
  "wsh",
  "xnk",
] as const;

const blockedExtensionRegex = new RegExp(
  `\\.(${BLOCKED_ATTACHMENT_EXTENSIONS.join("|")})$`,
  "i"
);

export const isBlockedAttachmentFilename = (filename: string): boolean =>
  blockedExtensionRegex.test(filename);

export const contentTypeFromFilename = (filename: string): string => {
  const extension = filename.split(".").pop()?.toLowerCase();
  return (
    (extension && ATTACHMENT_CONTENT_TYPES[extension]) ??
    "application/octet-stream"
  );
};

export const BLOCKED_ATTACHMENT_FILENAME_MESSAGE =
  "This file type isn't allowed for security reasons.";
