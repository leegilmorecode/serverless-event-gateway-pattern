import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

import { Construct } from 'constructs';
import { ExternalStackProps } from '../bin/external-system';
import { RemovalPolicy } from 'aws-cdk-lib';

export class ExternalSystemStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ExternalStackProps) {
    super(scope, id, props);

    if (!props?.edaApi) {
      throw new Error('no edaApi value supplied on the stack props');
    }

    const edaApi = props?.edaApi;

    const ordersTable: dynamodb.Table = new dynamodb.Table(
      this,
      'ExternalOrdersTable',
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: 'ExternalOrdersTable',
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
        functionName: 'external-create-order-handler',
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
          EDA_API: edaApi,
        },
      });

    const deleteOrderHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'DeleteOrderHandler', {
        functionName: 'external-delete-order-handler',
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, '/../src/orders/delete-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: ordersTable.tableName,
          EDA_API: edaApi,
        },
      });

    ordersTable.grantWriteData(createOrderHandler);
    ordersTable.grantReadWriteData(deleteOrderHandler);

    const externalApi: apigw.RestApi = new apigw.RestApi(
      this,
      'ExternalSystemApi',
      {
        description: 'external system api',
        restApiName: 'external-system-api',
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

    // add the usage plan for the api
    const usagePlan: apigw.UsagePlan = externalApi.addUsagePlan('UsagePlan', {
      name: 'External',
      description: 'Usage plan for external customers',
      apiStages: [
        {
          api: externalApi,
          stage: externalApi.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 10,
        burstLimit: 2,
      },
    });
    usagePlan.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // add a specific api key for the usage plan
    const key = externalApi.addApiKey('ApiKey', {
      apiKeyName: 'InternalOrdersCompany',
      description: 'The API Key for the internal orders Company',
      value: 'SuperSecretKey!12345',
    });

    usagePlan.addApiKey(key);

    const orders: apigw.Resource = externalApi.root.addResource('orders');
    const order: apigw.Resource = orders.addResource('{id}');

    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    order.addMethod(
      'DELETE',
      new apigw.LambdaIntegration(deleteOrderHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );
  }
}
