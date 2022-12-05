import * as AWS from 'aws-sdk';

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import axios from 'axios';
import { v4 as uuid } from 'uuid';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async ({
  pathParameters,
}): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'delete-external-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { TABLE_NAME: tableName, EDA_API: edaApi } = process.env;

    if (!tableName) {
      throw new Error('config missing');
    }

    if (!pathParameters || !pathParameters.id) {
      throw new Error('no order id supplied');
    }

    const { id } = pathParameters;

    const getItemParams: AWS.DynamoDB.DocumentClient.GetItemInput = {
      TableName: tableName,
      Key: {
        id,
      },
    };

    console.log(`getting order ${id}`);

    const { Item: order } = await dynamoDb.get(getItemParams).promise();

    console.log(`deleting order ${id}`);

    const params: AWS.DynamoDB.DocumentClient.DeleteItemInput = {
      TableName: tableName,
      Key: {
        id,
      },
    };

    await dynamoDb.delete(params).promise();

    // the product is now cancelled so publish the event via the api
    const externalDomainEvent = {
      metadata: {
        source: 'com.external.orders',
        eventSchemaVersion: '1',
        eventName: 'OrderCancelled',
      },
      data: {
        ...order,
      },
    };

    // make a call to the eda api to publish an external domain event
    const { data } = await axios.request({
      url: 'events',
      method: 'post',
      baseURL: edaApi,
      data: externalDomainEvent,
    });

    console.log(`api response: ${JSON.stringify(data)}`);
    console.log(
      `domain event raised via api: ${JSON.stringify(externalDomainEvent)}`
    );

    return {
      statusCode: 200,
      body: 'OK',
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: 'An error occurred',
    };
  }
};
