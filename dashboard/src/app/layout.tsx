import React from 'react';
import { Metadata } from 'next';
import theme from '../theme';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v13-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Layout } from '../components/layout';
import { ApolloWrapper } from './ApolloWrapper';

export const metadata: Metadata = {
	title: 'GitLab Merger Bot',
	description: 'Welcome to Next.js',
};

export default function RootLayout({ children }: { children: React.ReactElement }) {
	return (
		<html lang='en'>
			<head>
				<meta
					name='viewport'
					content='minimum-scale=1, initial-scale=1, width=device-width'
				/>
			</head>
			<body style={{ backgroundColor: '#f8f8f8' }}>
				<ApolloWrapper>
					<AppRouterCacheProvider>
						<ThemeProvider theme={theme}>
							<CssBaseline />

							<Layout>{children}</Layout>
						</ThemeProvider>
					</AppRouterCacheProvider>
				</ApolloWrapper>
			</body>
		</html>
	);
}
