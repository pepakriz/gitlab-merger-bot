import React from 'react';
import { AppProps } from 'next/app';
import Head from 'next/head';
import { AppCacheProvider } from '@mui/material-nextjs/v14-pagesRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../theme';
import { NextPage } from 'next';
import { withApollo } from '../lib/apollo';

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: React.ReactElement) => React.ReactNode;
};

export type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const Page = withApollo(((props: AppPropsWithLayout) => {
	const { Component, pageProps } = props;
	const getLayout = Component.getLayout ?? ((page) => page);
	return getLayout(<Component {...pageProps} />);
}) as NextPage);

export default function MyApp(props: AppPropsWithLayout) {
	return (
		<AppCacheProvider {...props}>
			<Head>
				<title>GitLab Merger Bot</title>
				<meta
					name='viewport'
					content='minimum-scale=1, initial-scale=1, width=device-width'
				/>
			</Head>
			<ThemeProvider theme={theme}>
				<CssBaseline />
				<Page {...props} />
			</ThemeProvider>
		</AppCacheProvider>
	);
}
