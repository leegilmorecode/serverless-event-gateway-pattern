import * as AWS from 'aws-sdk';

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { Order } from '../types';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async ({
  body,
}): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { TABLE_NAME: tableName } = process.env;

    if (!tableName) {
      throw new Error('config missing');
    }

    if (!body) {
      throw new Error('no order supplied');
    }

    const { data } = JSON.parse(body);
    const { id, productId, quantity } = data as Order;

    console.log(`${prefix} - order id ${id}`);

    const order: Order = {
      id,
      productId,
      quantity,
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: tableName,
      Item: order,
    };

    await dynamoDb.put(params).promise();

    return {
      statusCode: 201,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: 'An error occurred',
    };
  }
};
