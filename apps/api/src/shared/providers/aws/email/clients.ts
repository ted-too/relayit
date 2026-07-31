import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SNSClient } from "@aws-sdk/client-sns";
import type { ChannelCredentials } from "@repo/api/channels/base";
import { decryptRecord } from "@repo/api/db/crypto";
import { awsCredentialsSchema } from "@repo/api/providers/aws/credentials";
import type * as z from "zod";

type AwsCredentials = z.infer<typeof awsCredentialsSchema>;

function parseAwsCredentials(credentials: ChannelCredentials): AwsCredentials {
  const decryptResult = decryptRecord(credentials.encrypted);
  if (decryptResult.error) {
    throw decryptResult.error;
  }

  const parseResult = awsCredentialsSchema.safeParse({
    encrypted: decryptResult.data,
    unencrypted: credentials.unencrypted,
  });

  if (!parseResult.success) {
    throw parseResult.error;
  }

  return parseResult.data;
}

function sdkClientConfig(credentials: ChannelCredentials) {
  const aws = parseAwsCredentials(credentials);
  return {
    region: aws.unencrypted.region,
    credentials: {
      accessKeyId: aws.encrypted.accessKeyId,
      secretAccessKey: aws.encrypted.secretAccessKey,
    },
  };
}

export function awsSesRegion(credentials: ChannelCredentials) {
  return parseAwsCredentials(credentials).unencrypted.region;
}

export function buildSesClient(credentials: ChannelCredentials) {
  return new SESv2Client(sdkClientConfig(credentials));
}

export function buildSnsClient(credentials: ChannelCredentials) {
  return new SNSClient(sdkClientConfig(credentials));
}

export function buildAwsSdkConfig(credentials: ChannelCredentials) {
  return sdkClientConfig(credentials);
}
