import { createClient } from 'graphql-ws';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';

import { ApolloClient, InMemoryCache, NormalizedCacheObject, split } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { HttpLink } from '@apollo/client/link/http';

type TApolloClient = ApolloClient<NormalizedCacheObject>;

let globalApolloClient: TApolloClient;

export function initApolloClient(initialState?: {}) {
	if (typeof window === 'undefined') {
		return createApolloClient(initialState);
	}

	if (!globalApolloClient) {
		globalApolloClient = createApolloClient(initialState);
	}

	return globalApolloClient;
}

export function createApolloClient(initialState = {}) {
	const ssrMode = typeof window === 'undefined';
	const cache = new InMemoryCache().restore(initialState);

	let apiUrl = process.env.API_URL;
	if (apiUrl === undefined && typeof window !== 'undefined') {
		apiUrl = `${window.location.protocol}//${window.location.host}/graphql`;
	}

	const httpLink = new HttpLink({
		uri: apiUrl,
		credentials: 'same-origin',
	});

	if (!ssrMode) {
		let wsUrl = process.env.WS_URL;
		if (wsUrl === undefined) {
			wsUrl = `${window.location.protocol === 'http:' ? 'ws' : 'wss'}://${
				window.location.host
			}/graphql`;
		}

		const wsLink = new GraphQLWsLink(
			createClient({
				url: wsUrl,
			}),
		);

		const link = split(
			// split based on operation type
			({ query }) => {
				const definition = getMainDefinition(query);
				return (
					definition.kind === 'OperationDefinition' &&
					definition.operation === 'subscription'
				);
			},
			wsLink,
			httpLink,
		);

		return new ApolloClient({
			ssrMode,
			link,
			cache,
		});
	}

	return new ApolloClient({
		ssrMode,
		link: httpLink,
		cache,
	});
}
