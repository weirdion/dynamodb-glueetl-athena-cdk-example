"""
DynamoDB Data Seeder Lambda Function

This function populates the DynamoDB table with structured mock data
for demonstrating different data pipeline approaches.
"""

import json
import os
import random
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List

import boto3

# Environment variables
TABLE_NAME = os.environ['TABLE_NAME']

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)

# Constants for mock data generation
CATEGORIES = ['A', 'B', 'C']
STATUSES = ['active', 'inactive', 'pending']
REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1']
SOURCES = ['web', 'mobile', 'api']
TAGS_POOL = ['analytics', 'production', 'test', 'priority', 'archived', 'processed']


def generate_mock_record() -> Dict[str, Any]:
    """
    Generate a single mock data record with nested structures.

    Returns:
        Dictionary representing a DynamoDB item with structured data
    """
    # Generate timestamp within the last 30 days
    days_ago = random.randint(0, 30)
    hours_ago = random.randint(0, 23)
    timestamp = datetime.utcnow() - timedelta(days=days_ago, hours=hours_ago)

    # Select random tags (1-3 tags)
    num_tags = random.randint(1, 3)
    selected_tags = random.sample(TAGS_POOL, num_tags)

    record = {
        'id': str(uuid.uuid4()),
        'timestamp': timestamp.isoformat() + 'Z',
        'category': random.choice(CATEGORIES),
        'status': random.choice(STATUSES),
        'metadata': {
            'region': random.choice(REGIONS),
            'source': random.choice(SOURCES),
            'tags': selected_tags,
        },
        'metrics': {
            'count': random.randint(1, 1000),
            'value': Decimal(str(round(random.uniform(10.0, 1000.0), 2))),
            'score': random.randint(1, 100),
        }
    }

    return record


def batch_write_items(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Write items to DynamoDB in batches of 25 (DynamoDB limit).

    Args:
        items: List of DynamoDB items to write

    Returns:
        Dictionary with success count and any errors
    """
    success_count = 0
    errors = []

    # DynamoDB batch_writer handles batching automatically
    with table.batch_writer() as batch:
        for item in items:
            try:
                batch.put_item(Item=item)
                success_count += 1
            except Exception as e:
                errors.append({
                    'item_id': item.get('id', 'unknown'),
                    'error': str(e)
                })

    return {
        'success_count': success_count,
        'error_count': len(errors),
        'errors': errors
    }


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler function to seed DynamoDB table with mock data.

    Args:
        event: Lambda event object (can specify 'record_count' to override default)
        context: Lambda context object

    Returns:
        Response with status and details of seeding operation
    """
    try:
        # Allow override of record count via event
        record_count = event.get('record_count', 50)

        # Validate record count
        if not isinstance(record_count, int) or record_count < 1 or record_count > 500:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'error': 'record_count must be an integer between 1 and 500'
                })
            }

        print(f"Generating {record_count} mock records...")

        # Generate mock records
        items = [generate_mock_record() for _ in range(record_count)]

        print(f"Writing {len(items)} items to DynamoDB table: {TABLE_NAME}")

        # Write items to DynamoDB
        result = batch_write_items(items)

        response_body = {
            'message': 'Data seeding completed',
            'table_name': TABLE_NAME,
            'records_generated': record_count,
            'records_written': result['success_count'],
            'errors': result['error_count']
        }

        # Include error details if any
        if result['errors']:
            response_body['error_details'] = result['errors']

        print(f"Seeding completed: {result['success_count']} items written successfully")

        return {
            'statusCode': 200,
            'body': json.dumps(response_body, indent=2)
        }

    except Exception as e:
        error_message = f"Error seeding data: {str(e)}"
        print(error_message)

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': error_message
            })
        }
