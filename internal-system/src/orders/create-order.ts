import * as AWS from 'aws-sdk';

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { Order } from '../types';
import { PutEventsRequestEntry } from 'aws-sdk/clients/eventbridge';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();

export const handler: APIGatewayProxyHandler = async ({
  body,
}): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-internal-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { TABLE_NAME: tableName, SHARED_EVENT_BUS: sharedEventBus } =
      process.env;

    if (!tableName || !sharedEventBus) {
      throw new Error('config missing');
    }

    if (!body) {
      throw new Error('no order supplied');
    }

    const { id, productId, quantity } = JSON.parse(body) as Order;

    console.log(`${prefix} - order id ${id}`);

    const order: Order = {
      id,
      productId,
      quantity,
      status: 'created',
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: tableName,
      Item: order,
    };

    // persist the new order
    await dynamoDb.put(params).promise();

    const source = 'com.internal.orders';
    const detailType = 'OrderCreated';

    const createEvent: PutEventsRequestEntry = {
      Detail: JSON.stringify({
        metadata: {
          source,
          eventSchemaVersion: '1',
          eventName: detailType,
        },
        data: {
          ...order,
        },
      }),
      DetailType: detailType,
      EventBusName: sharedEventBus,
      Source: source,
    };

    const subscriptionEvent: AWS.EventBridge.PutEventsRequest = {
      Entries: [createEvent],
    };

    // publish the event for a new order
    await eventBridge.putEvents(subscriptionEvent).promise();

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
