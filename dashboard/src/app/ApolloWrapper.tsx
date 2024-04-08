'use client';

import React, { useState } from 'react';
import { initApolloClient } from '../lib/apollo';
import { ApolloProvider } from '@apollo/client';

export const ApolloWrapper = ({ children }: { children: React.ReactNode }) => {
	const [client] = useState(initApolloClient);

	return <ApolloProvider client={client}>{children}</ApolloProvider>;
};
