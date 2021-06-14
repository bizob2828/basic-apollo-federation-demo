const newrelic = require('newrelic')

const { ApolloGateway, RemoteGraphQLDataSource } = require("@apollo/gateway")
const { ApolloServer } = require("apollo-server")
const nrPlugin = require('@newrelic/apollo-server-plugin')
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
    const parentSegment = context['parent'] || nr.getActiveSegment()
    if (!parentSegment) {
      logger.trace('cannot find parent segment')
      return
    }

    // anyway to tie in to where that request is made and do magic?
    const gatewaySegment = nr.createSegment(
      `GraphQL/SubGraph/ApolloServer/${this.name}`,
      recordOperationSegment,
      parentSegment
    )

    if (!gatewaySegment) {
      logger.trace('cannot find gateway segment')
      return
    }
    gatewaySegment.start()

    nr.setActiveSegment(gatewaySegment)

    context[NR_SEGMENT] = gatewaySegment
    context['parent'] = parentSegment
  }

  didEncounterError(error) {
    // TODO: add errors to NR agent
  }

  didReceiveResponse({ request, response, context }) {
    const segment = nr.getActiveSegment()

    // this likely isn't necessary if segment set to active
    const gatewaySegment = context[NR_SEGMENT]
    if (!gatewaySegment) {
      logger.trace('cannot find gateway segment')
      return response
    }

    const query = cleanQuery(request.query)
    gatewaySegment.addAttribute('graphql.subgraph.query', query)
    gatewaySegment.end()

    const parent = context['parent']
    nr.setActiveSegment(parent)
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
