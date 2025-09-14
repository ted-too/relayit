import type {
  MessageEventError,
  ProviderCredential,
  ProviderIdentity,
} from "@repo/shared/db/types";
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

export type ProviderSendParams<T extends ChannelType> = {
  to: string;
  credentials: ProviderCredential;
  payload: SendRawPayload<T>;
  identity: ProviderIdentity;
};

export type SendMethod<T extends ChannelType, R = unknown> = (
  params: ProviderSendParams<T>
) => Promise<ProviderResult<R>>;

export interface INotificationProvider<T extends ChannelType, R = unknown> {
  send: SendMethod<T, R>;
}
