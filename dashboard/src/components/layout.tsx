'use client';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import React from 'react';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import { useQuery } from '@apollo/client';
import { MeQuery } from '../types';
import gql from 'graphql-tag';
import { Tab, Tabs } from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';
import { Route } from 'next';

const pages = {
	'/': {
		label: 'Merge Queue',
	},
	'/web-hook-history': {
		label: 'Web Hook History',
	},
} satisfies Record<Route, { label: string }>;

export const Layout = ({ children }: { children: React.ReactElement }) => {
	const pathname = usePathname();
	const router = useRouter();
	const { data } = useQuery<MeQuery>(gql`
		query Me {
			me {
				name
				avatarUrl
			}
		}
	`);

	const tabIndex = Object.keys(pages).findIndex((path) => pathname === path);

	return (
		<>
			<AppBar position='fixed'>
				<Toolbar>
					<Avatar alt='Remy Sharp' src={data?.me.avatarUrl} />
					&nbsp;&nbsp;&nbsp;
					<Typography variant='h6'>{data?.me.name}</Typography>
					<Tabs
						value={tabIndex}
						onChange={() => {}}
						textColor='inherit'
						sx={{
							px: 6,
							'& .MuiTabs-indicator': {
								backgroundColor: '#ffffff',
							},
						}}
					>
						{Object.entries(pages).map(([path, { label }]) => (
							<Tab key={path} label={label} onClick={() => router.push(path)} />
						))}
					</Tabs>
				</Toolbar>
			</AppBar>
			<Container maxWidth={'lg'}>
				<Box mt={12}>{children}</Box>
			</Container>
		</>
	);
};
