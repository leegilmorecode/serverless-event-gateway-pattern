#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { SharedResourcesStack } from '../lib/shared-resources-stack';

const app = new cdk.App();
new SharedResourcesStack(app, 'SharedResourcesStack', {});
