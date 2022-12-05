import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { Duration, RemovalPolicy, SecretValue } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { InternalStackProps } from '../bin/internal-system';

export class InternalSystemStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: InternalStackProps) {
    super(scope, id, props);

    if (!props?.sharedBusName) {
      throw new Error('no shared bus name on stack props');
    }

    if (!props?.externalApi) {
      throw new Error('no external api on stack props');
    }

    const { sharedBusName, externalApi } = props;

    const sharedEventBus = events.EventBus.fromEventBusName(
      this,
      'Shared-Event-Bus',
      sharedBusName
    );

    // create the orders connection for the api destination
    const externalOrdersConnection: events.Connection = new events.Connection(
      this,
      'ExternalOrdersApiDestinationsConnection',
      {
        authorization: events.Authorization.apiKey(
          'x-api-key',
          SecretValue.unsafePlainText('SuperSecretKey!12345') // this is for the demo only
        ),
        description: 'External Orders API Destination Connection',
        connectionName: 'ExternalOrdersApiDestinationsConnection',
      }
    );

    // create the api destination for the external orders connection
    const externalOrdersDestination: events.ApiDestination =
      new events.ApiDestination(this, 'ExternalOrdersDestination', {
        connection: externalOrdersConnection,
        endpoint: `${externalApi}/orders/`,
        description: 'The api destination for our external orders api',
        rateLimitPerSecond: 50,
        httpMethod: events.HttpMethod.POST,
        apiDestinationName: 'ExternalOrdersDestination',
      });

    // create the target rule for the api destination
    new events.Rule(this, 'ExternalOrdersApiDestinationsRule', {
      eventBus: sharedEventBus,
      ruleName: 'ExternalOrdersApiDestinationsRule',
      description: 'Rule for the external orders API Destination',
      eventPattern: {
        source: ['com.internal.orders'],
        detailType: ['OrderCreated'], // when an order is created in the internal system
      },
      targets: [
        new targets.ApiDestination(externalOrdersDestination, {
          retryAttempts: 10,
          event: events.RuleTargetInput.fromEventPath('$.detail'), // we only want to pass the http body as the detail
          headerParameters: {},
          queryStringParameters: {},
          maxEventAge: Duration.minutes(60),
          deadLetterQueue: new sqs.Queue(this, 'external-orders-api-dlq', {
            removalPolicy: RemovalPolicy.DESTROY,
            queueName: 'external-orders-api-dlq', // we ensure any failures go to a dead letter queue
          }),
        }),
      ],
    });

    const ordersTable: dynamodb.Table = new dynamodb.Table(
      this,
      'InternalOrdersTable',
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: 'InternalOrdersTable',
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    const createOrderHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CreateOrderHandler', {
        functionName: 'internal-create-order-handler',
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, '/../src/orders/create-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
          SHARED_EVENT_BUS: sharedEventBus.eventBusName,
        },
      });

    const cancelOrderHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CancelOrderHandler', {
        functionName: 'internal-cancel-order-handler',
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, '/../src/orders/cancel-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
        },
      });

    ordersTable.grantWriteData(createOrderHandler);
    ordersTable.grantWriteData(cancelOrderHandler);
    sharedEventBus.grantPutEventsTo(createOrderHandler);

    // create the target rule for the cancel order lambda
    new events.Rule(this, 'OrderCancelledRule', {
      eventBus: sharedEventBus,
      ruleName: 'OrderCancelledRule',
      description: 'Rule for the external order cancellation',
      eventPattern: {
        source: ['com.external.orders'],
        detailType: ['OrderCancelled'], // only invoked when an external order is cancelled
      },
      targets: [new targets.LambdaFunction(cancelOrderHandler, {})],
    });

    const internalApi: apigw.RestApi = new apigw.RestApi(
      this,
      'InternalSystemAPi',
      {
        description: 'internal system api',
        restApiName: 'internal-system-api',
        deploy: true,
        deployOptions: {
          stageName: 'prod',
          dataTraceEnabled: true,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: true,
          metricsEnabled: true,
        },
      }
    );

    const orders: apigw.Resource = internalApi.root.addResource('orders');
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );
  }
}
