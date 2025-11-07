import {
  Aws,
  CfnOutput,
  Stack,
  StackProps,
  Tags
} from 'aws-cdk-lib';
import {
  CfnCrawler
} from 'aws-cdk-lib/aws-glue';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal
} from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface ExportIonStackProps extends StackProps {
  readonly bucketName: string;
  readonly databaseName: string;
  readonly tableName: string;
}

/**
 * ExportIonStack - Demonstrates DynamoDB Export to ION format
 *
 * This stack shows Approach 2: Using DynamoDB Export feature with ION format.
 *
 * Problem demonstrated:
 * - ION is a compact, binary format that's efficient for storage
 * - However, Athena lacks native SerDe support for ION format
 * - Crawler may create a table, but queries will fail in Athena
 */
export class ExportIonStack extends Stack {
  public readonly crawler: CfnCrawler;
  public readonly crawlerRole: Role;

  constructor(scope: Construct, id: string, props: ExportIonStackProps) {
    super(scope, id, props);

    const bucket = Bucket.fromBucketName(this, 'ImportedBucket', props.bucketName);
    const s3ExportPath = `s3://${props.bucketName}/exports/ion/`;

    // IAM Role for Glue Crawler
    this.crawlerRole = new Role(this, 'IonCrawlerRole', {
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
      description: 'IAM role for Glue crawler to crawl ION exports',
    });

    // Grant S3 read permissions
    this.crawlerRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket'
      ],
      resources: [
        bucket.bucketArn,
        `${bucket.bucketArn}/exports/ion/*`
      ],
    }));

    // Grant Glue permissions
    this.crawlerRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'glue:GetDatabase',
        'glue:GetTable',
        'glue:GetTables',
        'glue:CreateTable',
        'glue:UpdateTable',
        'glue:DeleteTable',
        'glue:GetPartitions',
        'glue:CreatePartition',
        'glue:UpdatePartition',
        'glue:DeletePartition'
      ],
      resources: [
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:catalog`,
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:database/${props.databaseName}`,
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${props.databaseName}/*`
      ],
    }));

    // CloudWatch Logs permissions
    this.crawlerRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws-glue/crawlers:*`
      ],
    }));

    // Glue Crawler for ION exports
    this.crawler = new CfnCrawler(this, 'IonExportCrawler', {
      name: 'ion-export-crawler',
      role: this.crawlerRole.roleArn,
      databaseName: props.databaseName,
      targets: {
        s3Targets: [
          {
            path: s3ExportPath,
          }
        ],
      },
      tablePrefix: 'ion_export_',
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
      configuration: JSON.stringify({
        Version: 1.0,
        CrawlerOutput: {
          Partitions: { AddOrUpdateBehavior: 'InheritFromTable' },
        },
      }),
    });

    // Add resource tags
    Tags.of(this).add('Stack', 'ExportIonStack');

    // CloudFormation Outputs
    new CfnOutput(this, 'CrawlerName', {
      value: this.crawler.name as string,
      description: 'Glue crawler name for ION exports',
    });

    new CfnOutput(this, 'ExportPath', {
      value: s3ExportPath,
      description: 'S3 path where ION exports should be placed',
    });

    new CfnOutput(this, 'ExportCommandExample', {
      value: this.generateExportCommand(props.tableName, props.bucketName),
      description: 'Example AWS CLI command to trigger DynamoDB export (ION)',
    });

    new CfnOutput(this, 'CrawlerRunCommand', {
      value: `aws glue start-crawler --name ${this.crawler.name}`,
      description: 'Command to run the crawler after export completes',
    });

    new CfnOutput(this, 'ProblemDescription', {
      value: 'Athena will fail to query ION format - SerDe not supported',
      description: 'Issue demonstrated by this approach',
    });
  }

  /**
   * Generates an example DynamoDB export command for ION format
   */
  private generateExportCommand(tableName: string, bucketName: string): string {
    return `aws dynamodb export-table-to-point-in-time \\
  --table-arn arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${tableName} \\
  --s3-bucket ${bucketName} \\
  --s3-prefix exports/ion/ \\
  --export-format ION`;
  }
}
