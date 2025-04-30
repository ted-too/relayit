export const AVAILABLE_MESSAGE_STATUSES = [
  "queued",
  "processing",
  "sent",
  "failed",
  "delivered",
] as const;

export const AVAILABLE_CHANNELS = [
  "email",
  "sms",
  "whatsapp",
  "discord",
] as const;

export const AVAILABLE_EMAIL_PROVIDERS = ["ses"] as const;

export const AVAILABLE_SMS_PROVIDERS = ["sns"] as const;

export const AVAILABLE_PROVIDER_TYPES = [
  ...AVAILABLE_EMAIL_PROVIDERS,
  ...AVAILABLE_SMS_PROVIDERS,
] as const;
