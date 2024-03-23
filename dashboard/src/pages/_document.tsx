import React from 'react';
import { Head, Main, Html, NextScript, DocumentProps, DocumentContext } from 'next/document';
import {
	DocumentHeadTags,
	DocumentHeadTagsProps,
	documentGetInitialProps,
} from '@mui/material-nextjs/v14-pagesRouter';
import theme from '../theme';

export default function AppDocument(props: DocumentProps & DocumentHeadTagsProps) {
	return (
		<Html lang='en'>
			<Head>
				{/* PWA primary color */}
				<meta name='theme-color' content={theme.palette.primary.main} />
				<link
					rel='stylesheet'
					href='https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap'
				/>
				<DocumentHeadTags {...props} />
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}

AppDocument.getInitialProps = async (ctx: DocumentContext) => {
	const finalProps = await documentGetInitialProps(ctx);
	return finalProps;
};
