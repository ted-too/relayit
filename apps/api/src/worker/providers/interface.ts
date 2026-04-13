import type {
  MessageEventError,
  ProviderCredential,
  ProviderIdentity,
} from "@repo/api/db/types";
import type { ChannelType, SendRawPayload } from "@repo/shared/providers";

export interface ProviderError extends MessageEventError {
  retryable: boolean;
}

export type ProviderResult<T> =
  | {
      error: null;
      data: T;
    }
  | {
      error: ProviderError;
      data: null;
    };

export interface ProviderSendParams<T extends ChannelType> {
  credentials: ProviderCredential;
  identity: ProviderIdentity;
  payload: SendRawPayload<T>;
  to: string;
}

export type SendMethod<T extends ChannelType, R = unknown> = (
  params: ProviderSendParams<T>
) => Promise<ProviderResult<R>>;

export interface INotificationProvider<T extends ChannelType, R = unknown> {
  send: SendMethod<T, R>;
}
