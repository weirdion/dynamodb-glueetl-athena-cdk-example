import {
  Aws,
  CfnOutput,
  Stack,
  StackProps,
  Tags
} from 'aws-cdk-lib';
import { CfnCrawler } from 'aws-cdk-lib/aws-glue';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CrawlerDynamoDbStackProps extends StackProps {
  readonly databaseName: string;
  readonly tableName: string;
  readonly tableArn: string;
}

/**
 * CrawlerDynamoDbStack - Demonstrates Glue Crawler reading DynamoDB directly
 *
 * This stack shows Approach 1: The "most obvious" approach that seems right but fails.
 *
 * Problem demonstrated:
 * - Glue Crawler can catalog a DynamoDB table successfully
 * - Creates a table in the Glue Data Catalog with proper schema
 * - However, Athena CANNOT query DynamoDB tables directly
 *
 * This demonstrates a common misconception: just because Glue can catalog
 * a data source doesn't mean Athena can query it.
 */
export class CrawlerDynamoDbStack extends Stack {
  public readonly crawler: CfnCrawler;
  public readonly crawlerRole: Role;

  constructor(scope: Construct, id: string, props: CrawlerDynamoDbStackProps) {
    super(scope, id, props);

    // IAM Role for Glue Crawler
    this.crawlerRole = new Role(this, 'DynamoDbCrawlerRole', {
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
      description: 'IAM role for Glue crawler to catalog DynamoDB table',
    });

    // Grant DynamoDB permissions
    this.crawlerRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:DescribeTable',
        'dynamodb:Scan'
      ],
      resources: [props.tableArn],
    }));

    // Grant Glue Data Catalog permissions
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

    // Glue Crawler targeting DynamoDB directly
    this.crawler = new CfnCrawler(this, 'DynamoDbDirectCrawler', {
      name: 'dynamodb-direct-crawler',
      role: this.crawlerRole.roleArn,
      databaseName: props.databaseName,
      targets: {
        dynamoDbTargets: [
          {
            path: props.tableName,
          }
        ],
      },
      tablePrefix: 'dynamodb_direct_',
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
    Tags.of(this).add('Stack', 'CrawlerDynamoDbStack');

    // CloudFormation Outputs
    new CfnOutput(this, 'CrawlerName', {
      value: this.crawler.name as string,
      description: 'Glue crawler name for direct DynamoDB catalog',
    });

    new CfnOutput(this, 'CrawlerRunCommand', {
      value: `aws glue start-crawler --name ${this.crawler.name}`,
      description: 'Command to run the crawler',
    });

    new CfnOutput(this, 'ExpectedTableName', {
      value: `dynamodb_direct_${props.tableName}`,
      description: 'Expected Glue table name after crawler runs',
    });

    new CfnOutput(this, 'ProblemDescription', {
      value: 'Crawler succeeds but Athena cannot query DynamoDB tables - only S3 sources supported',
      description: 'Issue demonstrated by this approach',
    });

    new CfnOutput(this, 'AthenaQueryExample', {
      value: `SELECT * FROM ${props.databaseName}.dynamodb_direct_${props.tableName} LIMIT 10;`,
      description: 'Query to try in Athena (will fail with "not on S3" error)',
    });
  }
}
