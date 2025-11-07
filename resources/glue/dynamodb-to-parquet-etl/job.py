"""
AWS Glue ETL Job: DynamoDB to Parquet

This job reads data directly from DynamoDB, transforms it to flatten nested structures,
and writes it to S3 in Parquet format for efficient querying with Athena.

This is the recommended approach because:
1. Parquet is columnar and compressed - efficient for analytics
2. Schema is clean and flattened - no nested type descriptors
3. Athena can query it directly with simple SQL
4. Better compression and query performance than JSON/ION
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql.functions import col, explode, size
from pyspark.sql.types import StringType, IntegerType, DoubleType, StructType, StructField, ArrayType

# Get job parameters
args = getResolvedOptions(sys.argv, [
    'JOB_NAME',
    'TABLE_NAME',
    'OUTPUT_PATH',
    'DATABASE_NAME'
])

# Initialize Glue context
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Log job parameters
print(f"Starting ETL job: {args['JOB_NAME']}")
print(f"Reading from DynamoDB table: {args['TABLE_NAME']}")
print(f"Writing to S3 path: {args['OUTPUT_PATH']}")
print(f"Target Glue database: {args['DATABASE_NAME']}")

# Read from DynamoDB
# Using the standard DynamoDB connector (not export connector)
# This uses DynamoDB Scan API - suitable for small to medium datasets
dynamodb_dyf = glueContext.create_dynamic_frame.from_options(
    connection_type="dynamodb",
    connection_options={
        "dynamodb.input.tableName": args['TABLE_NAME'],
        "dynamodb.throughput.read.percent": "0.5",  # Use 50% of table's read capacity
    }
)

print(f"Read {dynamodb_dyf.count()} records from DynamoDB")

# Convert to Spark DataFrame for easier manipulation
df = dynamodb_dyf.toDF()

# Print schema for debugging
print("Original schema from DynamoDB:")
df.printSchema()

# Flatten nested structures
# DynamoDB connector already converts to native types, so we just need to flatten
flattened_df = df.select(
    col("id").cast(StringType()).alias("id"),
    col("timestamp").cast(StringType()).alias("timestamp"),
    col("category").cast(StringType()).alias("category"),
    col("status").cast(StringType()).alias("status"),
    # Flatten metadata struct
    col("metadata.region").cast(StringType()).alias("region"),
    col("metadata.source").cast(StringType()).alias("source"),
    col("metadata.tags").alias("tags"),  # Keep as array
    # Flatten metrics struct
    col("metrics.count").cast(IntegerType()).alias("count"),
    col("metrics.value").cast(DoubleType()).alias("value"),
    col("metrics.score").cast(IntegerType()).alias("score")
)

print("Flattened schema:")
flattened_df.printSchema()

# Show sample data
print("Sample data (first 5 rows):")
flattened_df.show(5, truncate=False)

# Convert back to DynamicFrame
output_dyf = DynamicFrame.fromDF(flattened_df, glueContext, "output_dyf")

# Write to S3 in Parquet format
# Using Snappy compression (good balance of compression and speed)
print(f"Writing {output_dyf.count()} records to S3 in Parquet format...")

glueContext.write_dynamic_frame.from_options(
    frame=output_dyf,
    connection_type="s3",
    connection_options={
        "path": args['OUTPUT_PATH'],
        "partitionKeys": []  # No partitioning for this simple example
    },
    format="parquet",
    format_options={
        "compression": "snappy"
    }
)

print("ETL job completed successfully!")
print(f"Data written to: {args['OUTPUT_PATH']}")
print("Run the Glue crawler to update the Data Catalog")

job.commit()
