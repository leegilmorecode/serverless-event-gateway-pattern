#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { InternalSystemStack } from '../lib/internal-system-stack';

export interface InternalStackProps extends cdk.StackProps {
  sharedBusName: string;
  externalApi: string;
}

const stackProps: InternalStackProps = {
  sharedBusName: 'shared-event-bus',
  externalApi:
    'https://your-external-api-rest-id.execute-api.your-region.amazonaws.com/prod',
};

const app = new cdk.App();
new InternalSystemStack(app, 'InternalSystemStack', stackProps);
