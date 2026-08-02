import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SNSClient } from "@aws-sdk/client-sns";
import type { ChannelCredentials } from "@repo/api/channels/base";
import { decryptRecord } from "@repo/api/db/crypto";
import { awsCredentialsSchema } from "@repo/api/providers/aws/credentials";
import type * as z from "zod";

type AwsCredentials = z.infer<typeof awsCredentialsSchema>;

async function parseAwsCredentials(
  credentials: ChannelCredentials
): Promise<AwsCredentials> {
  const decryptResult = await decryptRecord(
    credentials.encrypted as Record<string, unknown>
  );
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

async function sdkClientConfig(credentials: ChannelCredentials) {
  const aws = await parseAwsCredentials(credentials);
  return {
    region: aws.unencrypted.region,
    credentials: {
      accessKeyId: aws.encrypted.accessKeyId,
      secretAccessKey: aws.encrypted.secretAccessKey,
    },
  };
}

export async function awsSesRegion(credentials: ChannelCredentials) {
  return (await parseAwsCredentials(credentials)).unencrypted.region;
}

export async function buildSesClient(credentials: ChannelCredentials) {
  return new SESv2Client(await sdkClientConfig(credentials));
}

export async function buildSnsClient(credentials: ChannelCredentials) {
  return new SNSClient(await sdkClientConfig(credentials));
}

export async function buildAwsSdkConfig(credentials: ChannelCredentials) {
  return sdkClientConfig(credentials);
}
