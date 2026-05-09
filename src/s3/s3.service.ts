import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Service {
  private readonly client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new S3Client(this.createClientConfig());
  }

  async getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error('S3 object body is empty.');
    }

    return response.Body.transformToByteArray();
  }

  async putObjectBytes(params: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
  }

  private createClientConfig(): S3ClientConfig {
    const accessKeyId = this.configService.get<string>('s3.accessKeyId');
    const secretAccessKey =
      this.configService.get<string>('s3.secretAccessKey');

    return {
      region: this.configService.getOrThrow<string>('s3.region'),
      endpoint: this.configService.get<string>('s3.endpoint'),
      forcePathStyle:
        this.configService.getOrThrow<boolean>('s3.forcePathStyle'),
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
    };
  }
}
