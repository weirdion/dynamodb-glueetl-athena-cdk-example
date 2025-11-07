import {
  Aws,
  CfnOutput,
  Stack,
  StackProps,
  Tags
} from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  CfnCrawler,
  CfnJob
} from 'aws-cdk-lib/aws-glue';
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { join } from 'path';

export interface EtlParquetStackProps extends StackProps {
  readonly bucketName: string;
  readonly databaseName: string;
  readonly tableName: string;
  readonly tableArn: string;
}

/**
 * EtlParquetStack - Demonstrates Glue ETL job with Parquet output
 *
 * This stack shows Approach 3: The recommended solution.
 *
 * Benefits:
 * - Reads directly from DynamoDB (no export needed)
 * - Transforms data to flatten nested structures
 * - Outputs Parquet format (columnar, compressed, efficient)
 * - Creates clean schema in Glue Data Catalog
 * - Enables simple, performant Athena queries
 */
export class EtlParquetStack extends Stack {
  public readonly etlJob: CfnJob;
  public readonly crawler: CfnCrawler;
  public readonly etlRole: Role;
  public readonly crawlerRole: Role;

  constructor(scope: Construct, id: string, props: EtlParquetStackProps) {
    super(scope, id, props);

    const bucket = Bucket.fromBucketName(this, 'ImportedBucket', props.bucketName);
    const table = Table.fromTableArn(this, 'ImportedTable', props.tableArn);
    const s3OutputPath = `s3://${props.bucketName}/data/parquet/`;

    // Upload Glue job script to S3
    const scriptAsset = new Asset(this, 'GlueJobScript', {
      path: join(__dirname, '../../resources/glue/dynamodb-to-parquet-etl/job.py'),
    });

    // IAM Role for Glue ETL Job
    this.etlRole = new Role(this, 'GlueEtlJobRole', {
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
      description: 'IAM role for Glue ETL job to read DynamoDB and write Parquet',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // Grant DynamoDB read permissions
    this.etlRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:DescribeTable',
        'dynamodb:Scan',
        'dynamodb:Query'
      ],
      resources: [props.tableArn],
    }));

    // Grant S3 permissions for reading script and writing output
    this.etlRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject'
      ],
      resources: [
        `${bucket.bucketArn}/data/parquet/*`,
        `${scriptAsset.bucket.bucketArn}/*`
      ],
    }));

    this.etlRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [
        bucket.bucketArn,
        scriptAsset.bucket.bucketArn
      ],
    }));

    // Grant Glue Data Catalog permissions
    this.etlRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'glue:GetDatabase',
        'glue:GetTable',
        'glue:GetTables',
        'glue:CreateTable',
        'glue:UpdateTable'
      ],
      resources: [
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:catalog`,
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:database/${props.databaseName}`,
        `arn:aws:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${props.databaseName}/*`
      ],
    }));

    // CloudWatch Logs permissions
    this.etlRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws-glue/jobs:*`
      ],
    }));

    // Glue ETL Job
    this.etlJob = new CfnJob(this, 'DynamoDbToParquetJob', {
      name: 'dynamodb-to-parquet-etl',
      role: this.etlRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: scriptAsset.s3ObjectUrl,
        pythonVersion: '3',
      },
      defaultArguments: {
        '--job-language': 'python',
        '--job-bookmark-option': 'job-bookmark-disable',
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--TABLE_NAME': props.tableName,
        '--OUTPUT_PATH': s3OutputPath,
        '--DATABASE_NAME': props.databaseName,
      },
      glueVersion: '5.0',
      maxRetries: 0,
      timeout: 60, // 60 minutes
      numberOfWorkers: 2,
      workerType: 'G.1X', // 1 DPU per worker
      description: 'ETL job to read DynamoDB and write Parquet to S3',
    });

    // IAM Role for Glue Crawler
    this.crawlerRole = new Role(this, 'ParquetCrawlerRole', {
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
      description: 'IAM role for Glue crawler to crawl Parquet data',
    });

    // Grant S3 read permissions for crawler
    this.crawlerRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket'
      ],
      resources: [
        bucket.bucketArn,
        `${bucket.bucketArn}/data/parquet/*`
      ],
    }));

    // Grant Glue Data Catalog permissions for crawler
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

    // CloudWatch Logs permissions for crawler
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

    // Glue Crawler for Parquet data
    this.crawler = new CfnCrawler(this, 'ParquetDataCrawler', {
      name: 'parquet-data-crawler',
      role: this.crawlerRole.roleArn,
      databaseName: props.databaseName,
      targets: {
        s3Targets: [
          {
            path: s3OutputPath,
          }
        ],
      },
      tablePrefix: 'parquet_',
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
    Tags.of(this).add('Stack', 'EtlParquetStack');

    // CloudFormation Outputs
    new CfnOutput(this, 'EtlJobName', {
      value: this.etlJob.name as string,
      description: 'Glue ETL job name',
    });

    new CfnOutput(this, 'CrawlerName', {
      value: this.crawler.name as string,
      description: 'Glue crawler name for Parquet data',
    });

    new CfnOutput(this, 'OutputPath', {
      value: s3OutputPath,
      description: 'S3 path where Parquet data is written',
    });

    new CfnOutput(this, 'RunEtlJobCommand', {
      value: `aws glue start-job-run --job-name ${this.etlJob.name}`,
      description: 'Command to run the ETL job',
    });

    new CfnOutput(this, 'CrawlerRunCommand', {
      value: `aws glue start-crawler --name ${this.crawler.name}`,
      description: 'Command to run the crawler after ETL job completes',
    });

    new CfnOutput(this, 'BenefitDescription', {
      value: 'Clean schema with native types - simple SQL queries in Athena',
      description: 'Advantage of this approach',
    });
  }
}
