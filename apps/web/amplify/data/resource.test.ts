// @vitest-environment node

import { AmplifyGraphqlApi, AmplifyGraphqlDefinition } from '@aws-amplify/graphql-api-construct';
import { App, Stack } from 'aws-cdk-lib';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { AccountPrincipal, Role } from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { schema } from './resource';

describe('data schema assembly', () => {
  it('builds the data construct without custom/model operation collisions', () => {
    // Run the real GraphQL transformer used by Amplify's data construct.
    // Type checking and resolver mocks do not expand generated model operations.
    const stack = new Stack(new App(), 'DataSchemaTest', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const role = new Role(stack, 'IdentityRole', {
      assumedBy: new AccountPrincipal('123456789012'),
    });
    const definition = schema.transform();
    const handler = new LambdaFunction(stack, 'Handler', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => null;'),
    });
    const api = new AmplifyGraphqlApi(stack, 'Data', {
      definition: AmplifyGraphqlDefinition.fromString(definition.schema),
      functionNameMap: Object.fromEntries(
        Object.keys(definition.lambdaFunctions).map((name) => [name, handler]),
      ),
      authorizationModes: {
        defaultAuthorizationMode: 'AMAZON_COGNITO_USER_POOLS',
        userPoolConfig: { userPool: new UserPool(stack, 'UserPool') },
        iamConfig: { enableIamAuthorizationMode: true },
        identityPoolConfig: {
          identityPoolId: 'us-east-1:00000000-0000-0000-0000-000000000000',
          authenticatedUserRole: role,
          unauthenticatedUserRole: role,
        },
      },
    });
    expect(api.resources.tables['ReportWork']).toBeDefined();
    const resolvers = Object.values(api.resources.cfnResources.cfnResolvers);
    for (const [typeName, fieldName] of [
      ['Query', 'getReportWork'],
      ['Mutation', 'updateReportWork'],
      ['Query', 'listMyReportWork'],
      ['Query', 'listReportWorks'],
    ]) {
      expect(
        resolvers.filter(
          (resolver) => resolver.typeName === typeName && resolver.fieldName === fieldName,
        ),
      ).toHaveLength(1);
    }
    expect(resolvers.some((resolver) => resolver.fieldName === 'createReportWork')).toBe(false);
    expect(resolvers.some((resolver) => resolver.fieldName === 'deleteReportWork')).toBe(false);
  });
});
