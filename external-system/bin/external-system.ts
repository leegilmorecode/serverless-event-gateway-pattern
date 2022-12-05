#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { ExternalSystemStack } from '../lib/external-system-stack';

export interface ExternalStackProps extends cdk.StackProps {
  edaApi: string;
}

const stackProps: ExternalStackProps = {
  edaApi:
    'https://external-aip-restid.execute-api.your-region.amazonaws.com/prod/', // this is your eda account api
};

const app = new cdk.App();
new ExternalSystemStack(app, 'ExternalSystemStack', stackProps);
