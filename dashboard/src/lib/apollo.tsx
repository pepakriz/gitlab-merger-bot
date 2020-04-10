import { NextPage, NextPageContext } from 'next';
import React from 'react';

import Head from 'next/head';
import { ApolloProvider } from '@apollo/react-hooks';
import { ApolloClient } from 'apollo-client';
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';
import fetch from 'isomorphic-unfetch';
import { WebSocketLink } from 'apollo-link-ws';
import { getMainDefinition } from 'apollo-utilities';
import { split } from 'apollo-link';

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
						const { getDataFromTree } = await import('@apollo/react-ssr');
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
					Head.rewind();
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

	const httpLink = new HttpLink({
		uri: process.env.API_URL,
		credentials: 'same-origin',
		fetch,
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
