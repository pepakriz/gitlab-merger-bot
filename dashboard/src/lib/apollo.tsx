import { NextPage, NextPageContext } from 'next';
import React from 'react';

import {
	ApolloProvider,
	ApolloClient,
	InMemoryCache,
	NormalizedCacheObject,
	split,
} from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { HttpLink } from '@apollo/client/link/http';
import { WebSocketLink } from '@apollo/client/link/ws';

type TApolloClient = ApolloClient<NormalizedCacheObject>;

type InitialProps = {
	apolloClient: TApolloClient;
	apolloState: any;
} & Record<string, any>;

type WithApolloPageContext = {
	apolloClient: TApolloClient;
} & NextPageContext;

let globalApolloClient: TApolloClient;

export function withApollo(PageComponent: NextPage, { ssr = true } = {}) {
	const WithApollo = ({ apolloClient, apolloState, ...pageProps }: InitialProps) => {
		const client = apolloClient || initApolloClient(apolloState);
		return (
			<ApolloProvider client={client}>
				<PageComponent {...pageProps} />
			</ApolloProvider>
		);
	};

	if (ssr || PageComponent.getInitialProps) {
		WithApollo.getInitialProps = async (ctx: WithApolloPageContext) => {
			const { AppTree } = ctx;
			const apolloClient = (ctx.apolloClient = initApolloClient());

			let pageProps = {};
			if (PageComponent.getInitialProps) {
				pageProps = await PageComponent.getInitialProps(ctx);
			}

			if (typeof window === 'undefined') {
				if (ctx.res && ctx.res.finished) {
					return pageProps;
				}

				if (ssr) {
					try {
						const { getDataFromTree } = await import('@apollo/client/react/ssr');
						await getDataFromTree(
							<AppTree
								pageProps={{
									...pageProps,
									apolloClient,
								}}
							/>,
						);
					} catch (error) {
						console.error('Error while running `getDataFromTree`', error);
					}
				}
			}

			const apolloState = apolloClient.cache.extract();

			return {
				...pageProps,
				apolloState,
			};
		};
	}

	return WithApollo;
}

function initApolloClient(initialState?: {}) {
	if (typeof window === 'undefined') {
		return createApolloClient(initialState);
	}

	if (!globalApolloClient) {
		globalApolloClient = createApolloClient(initialState);
	}

	return globalApolloClient;
}

function createApolloClient(initialState = {}) {
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

		const wsLink = new WebSocketLink({
			uri: wsUrl,
			options: {
				reconnect: true,
			},
		});

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
