import { ApolloGateway, RemoteGraphQLDataSource } from "@apollo/gateway";
import { ApolloServer } from "apollo-server";
const nrPlugin = require('@newrelic/apollo-server-plugin')
const newrelic = require('newrelic')
const nr = newrelic.shim;
const logger = nr.logger.child({ component: 'ApolloGatewayService' })
const NR_SEGMENT = Symbol('nrSegment')
function recordOperationSegment(segment, scope) {
  const duration = segment.getDurationInMillis()
  const exclusive = segment.getExclusiveDurationInMillis()

  const transaction = segment.transaction

  createMetricPairs(transaction, segment.name, scope, duration, exclusive)
}

function createMetricPairs(transaction, name, scope, duration, exclusive) {
  if (scope) {
    transaction.measure(name, scope, duration, exclusive)
  }

  transaction.measure(name, null, duration, exclusive)
}

function cleanQuery(query) {
  const regex = /\([\s\S]+?[^\)]\)/g

  return query.replace(regex, '(***)')
}

class NRDataSource extends RemoteGraphQLDataSource {
  willSendRequest({ request, context }) {
    const parentSegment = nr.getActiveSegment()
    if (!parentSegment) {
      logger.trace('cannot find parent segment')
      return
    }
    const gatewaySegment = nr.createSegment(
      `GraphQL/operation/ApolloGateway/query/${this.name}`,
      recordOperationSegment,
      parentSegment
    )

    if (!gatewaySegment) {
      logger.trace('cannot find gateway segment')
      return
    }
    gatewaySegment.start()
    context[NR_SEGMENT] = gatewaySegment
  }

  didEncounterError(error) {
    // TODO: add errors to NR agent
  }

  didReceiveResponse({ request, response, context }) {
    const gatewaySegment = context[NR_SEGMENT]
    if (!gatewaySegment) {
      logger.trace('cannot find gateway segment')
      return response
    }

    const query = cleanQuery(request.query)
    gatewaySegment.addAttribute('graphql.operation.query', query)
    gatewaySegment.end()
    return response;
  }
}

const port = 4000;

const gateway = new ApolloGateway({
  serviceList: [
    { name: "people", url: "http://localhost:4001" },
    { name: "films", url: "http://localhost:4002" },
  ],
  buildService({ name, url }) {
    return new NRDataSource({ name, url })
  }
});

const server = new ApolloServer({
  gateway,
  plugins: [
    nrPlugin
  ],
  subscriptions: false,
});

server.listen({ port }).then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
