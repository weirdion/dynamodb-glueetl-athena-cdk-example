#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { DataStack } from '../lib/stacks/data-stack';
import { CrawlerDynamoDbStack } from '../lib/stacks/crawler-dynamodb-stack';
import { ExportJsonStack } from '../lib/stacks/export-json-stack';
import { ExportIonStack } from '../lib/stacks/export-ion-stack';
import { EtlParquetStack } from '../lib/stacks/etl-parquet-stack';

/**
 * DynamoDB to Athena Data Pipeline Example
 *
 * This CDK app demonstrates four different approaches to extract data from DynamoDB
 * and query it via Athena, highlighting the pitfalls and the recommended solution.
 *
 * Stack deployment order:
 * 1. DataStack - Foundation (DynamoDB, S3, Glue DB, Athena)
 * 2. CrawlerDynamoDbStack - Approach 1 (Crawler reads DynamoDB directly - fails in Athena)
 * 3. ExportJsonStack - Approach 2 (DynamoDB Export JSON - problematic)
 * 4. ExportIonStack - Approach 3 (DynamoDB Export ION - problematic)
 * 5. EtlParquetStack - Approach 4 (Glue ETL Parquet - recommended)
 */

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

Tags.of(app).add('Project', 'DynamoDB-Glue-Athena-Pipeline');
Tags.of(app).add('Purpose', 'Demo');

// Deploy foundation infrastructure
const dataStack = new DataStack(app, 'DataStack', {
  env,
  description: 'Foundation stack with DynamoDB, S3, Glue Database, and Athena Workgroup',
});

// Approach 1 - Deploy Crawler reading DynamoDB directly (demonstrates Athena incompatibility)
const crawlerDynamoDbStack = new CrawlerDynamoDbStack(app, 'CrawlerDynamoDbStack', {
  env,
  databaseName: dataStack.databaseName,
  tableName: dataStack.table.tableName,
  tableArn: dataStack.table.tableArn,
  description: 'Approach 1: Glue Crawler reads DynamoDB directly (Athena cannot query non-S3 sources)',
});
crawlerDynamoDbStack.addDependency(dataStack);

// Approach 2 - Deploy JSON Export approach (demonstrates nested JSON problem)
const exportJsonStack = new ExportJsonStack(app, 'ExportJsonStack', {
  env,
  bucketName: dataStack.bucket.bucketName,
  databaseName: dataStack.databaseName,
  tableName: dataStack.table.tableName,
  description: 'Approach 2: DynamoDB Export to JSON (demonstrates nested structure problem)',
});
exportJsonStack.addDependency(dataStack);

// Approach 3 - Deploy ION Export approach (demonstrates Athena incompatibility)
const exportIonStack = new ExportIonStack(app, 'ExportIonStack', {
  env,
  bucketName: dataStack.bucket.bucketName,
  databaseName: dataStack.databaseName,
  tableName: dataStack.table.tableName,
  description: 'Approach 3: DynamoDB Export to ION (demonstrates Athena SerDe incompatibility)',
});
exportIonStack.addDependency(dataStack);

// Approach 4 - Deploy Glue ETL with Parquet approach (recommended solution)
const etlParquetStack = new EtlParquetStack(app, 'EtlParquetStack', {
  env,
  bucketName: dataStack.bucket.bucketName,
  databaseName: dataStack.databaseName,
  tableName: dataStack.table.tableName,
  tableArn: dataStack.table.tableArn,
  description: 'Approach 4: Glue ETL to Parquet (recommended solution with clean schema)',
});
etlParquetStack.addDependency(dataStack);
