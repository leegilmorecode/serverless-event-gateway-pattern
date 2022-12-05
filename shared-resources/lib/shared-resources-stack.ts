import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';

export class SharedResourcesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sharedEventLogs: logs.LogGroup = new logs.LogGroup(
      this,
      'shared-event-logs',
      {
        logGroupName: 'shared-event-logs',
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    const sharedEventBus: events.EventBus = new events.EventBus(
      this,
      'shared-event-bus',
      {
        eventBusName: 'shared-event-bus',
      }
    );
    sharedEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const sharedEdaApi: apigw.RestApi = new apigw.RestApi(
      this,
      'SharedEdaApi',
      {
        description: 'shared eda api',
        restApiName: 'shared-eda-api',
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

    const externalDomainEvents: apigw.Resource =
      sharedEdaApi.root.addResource('events');

    const apigwRole: iam.Role = new iam.Role(this, 'ApigwSharedEventBusRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        putEvents: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['events:PutEvents'],
              resources: [sharedEventBus.eventBusArn],
            }),
          ],
        }),
      },
    });

    const eventBridgeOptions: apigw.IntegrationOptions = {
      credentialsRole: apigwRole,
      requestParameters: {
        'integration.request.header.X-Amz-Target': "'AWSEvents.PutEvents'",
        'integration.request.header.Content-Type':
          "'application/x-amz-json-1.1'",
      },
      requestTemplates: {
        'application/json': `{"Entries": [{"Source": "$util.escapeJavaScript($input.path('$.metadata.source'))", "Detail":"$util.escapeJavaScript($input.json('$'))", "DetailType": "$util.escapeJavaScript($input.path('$.metadata.eventName'))", "EventBusName": "${sharedEventBus.eventBusName}"}]}`,
      },
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': 'Created',
          },
        },
      ],
    };

    externalDomainEvents.addMethod(
      'POST',
      new apigw.Integration({
        type: apigw.IntegrationType.AWS,
        uri: `arn:aws:apigateway:${cdk.Aws.REGION}:events:path//`,
        integrationHttpMethod: 'POST',
        options: eventBridgeOptions,
      }),
      { methodResponses: [{ statusCode: '200' }] }
    );

    new events.Rule(this, 'LogAllEventsToCloudwatch', {
      eventBus: sharedEventBus,
      ruleName: 'LogAllEventsToCloudwatch',
      description: 'log all orders events',
      eventPattern: {
        source: [{ prefix: '' }] as any[], // match all events
      },
      targets: [new targets.CloudWatchLogGroup(sharedEventLogs)],
    });
  }
}
