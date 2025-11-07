import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags
} from 'aws-cdk-lib';
import { CfnWorkGroup } from 'aws-cdk-lib/aws-athena';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption
} from 'aws-cdk-lib/aws-dynamodb';
import { CfnDatabase } from 'aws-cdk-lib/aws-glue';
import {
  Code,
  Function as LambdaFunction,
  Runtime
} from 'aws-cdk-lib/aws-lambda';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { join } from 'path';

/**
 * DataStack - Foundation stack providing shared infrastructure
 *
 * This stack creates:
 * - DynamoDB table with sample data structure
 * - S3 bucket with organized prefixes for different data formats
 * - Glue Database for catalog tables
 * - Athena Workgroup for querying
 * - Lambda function for seeding data (manual invocation)
 */
export class DataStack extends Stack {
  public readonly table: Table;
  public readonly bucket: Bucket;
  public readonly database: CfnDatabase;
  public readonly databaseName: string;
  public readonly workgroup: CfnWorkGroup;
  public readonly seederFunction: LambdaFunction;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    this.table = new Table(this, 'SampleDataTable', {
      tableName: 'sample-data-table',
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true, // Required for DynamoDB Export
      },
      removalPolicy: RemovalPolicy.DESTROY, // For demo purposes
      encryption: TableEncryption.AWS_MANAGED,
    });

    // S3 Bucket for data storage
    this.bucket = new Bucket(this, 'DataPipelineBucket', {
      bucketName: `data-pipeline-bucket-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY, // For demo purposes
      autoDeleteObjects: true, // For demo purposes
      lifecycleRules: [
        {
          id: 'DeleteOldExports',
          prefix: 'exports/',
          expiration: Duration.days(30),
        },
        {
          id: 'DeleteOldAthenaResults',
          prefix: 'athena-results/',
          expiration: Duration.days(7),
        },
      ],
    });

    // Glue Database
    this.databaseName = 'data_pipeline_db';
    this.database = new CfnDatabase(this, 'DataPipelineDatabase', {
      catalogId: Aws.ACCOUNT_ID,
      databaseInput: {
        name: this.databaseName,
        description: 'Database for DynamoDB to Athena data pipeline examples',
      },
    });

    // Athena Workgroup
    this.workgroup = new CfnWorkGroup(this, 'DataPipelineWorkgroup', {
      name: 'data-pipeline-workgroup',
      description: 'Workgroup for querying DynamoDB export data',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${this.bucket.bucketName}/athena-results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false, // Disable to reduce costs for demo
      },
    });

    // Lambda Function for Data Seeding
    this.seederFunction = new LambdaFunction(this, 'DataSeederFunction', {
      functionName: 'data-seeder',
      runtime: Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: Code.fromAsset(join(__dirname, '../../resources/lambda/data-seeder')),
      timeout: Duration.minutes(5),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      description: 'Seeds DynamoDB table with structured mock data',
    });

    // Grant Lambda permissions to write to DynamoDB
    this.table.grantWriteData(this.seederFunction);

    // Add resource tags
    Tags.of(this).add('Stack', 'DataStack');

    // CloudFormation Outputs
    new CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: 'DataPipelineTableName',
    });

    new CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN',
      exportName: 'DataPipelineTableArn',
    });

    new CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name',
      exportName: 'DataPipelineBucketName',
    });

    new CfnOutput(this, 'BucketArn', {
      value: this.bucket.bucketArn,
      description: 'S3 bucket ARN',
      exportName: 'DataPipelineBucketArn',
    });

    new CfnOutput(this, 'DatabaseName', {
      value: this.databaseName,
      description: 'Glue database name',
      exportName: 'DataPipelineDatabaseName',
    });

    new CfnOutput(this, 'WorkgroupName', {
      value: this.workgroup.name,
      description: 'Athena workgroup name',
      exportName: 'DataPipelineWorkgroupName',
    });

    new CfnOutput(this, 'SeederFunctionName', {
      value: this.seederFunction.functionName,
      description: 'Lambda seeder function name',
      exportName: 'DataPipelineSeederFunctionName',
    });

    new CfnOutput(this, 'SeederInvokeCommand', {
      value: `aws lambda invoke --function-name ${this.seederFunction.functionName} response.json`,
      description: 'Command to invoke the data seeder',
    });
  }
}
