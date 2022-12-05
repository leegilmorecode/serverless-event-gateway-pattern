import * as AWS from 'aws-sdk';

import { EventBridgeEvent, Handler } from 'aws-lambda';

import { Order } from '../types';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: Handler<EventBridgeEvent<any, any>> = async (
  event: EventBridgeEvent<any, any>
): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = 'cancel-internal-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { TABLE_NAME: tableName } = process.env;

    if (!tableName) {
      throw new Error('config missing');
    }

    if (!event) {
      throw new Error('no order supplied');
    }

    const {
      detail: { data },
    } = event;

    const { id, productId, quantity } = data as Order;

    console.log(`${prefix} - order id ${id}`);

    const order: Order = {
      id,
      productId,
      quantity,
      status: 'cancelled',
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: tableName,
      Item: order,
    };

    await dynamoDb.put(params).promise();
  } catch (error: any) {
    console.error(error.message);
    throw error;
  }
};
