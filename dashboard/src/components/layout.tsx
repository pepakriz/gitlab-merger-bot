import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';
import React from 'react';
import Link from 'next/link';
import { Button } from '@material-ui/core';
import Container from '@material-ui/core/Container';
import Paper from '@material-ui/core/Paper';
import Avatar from '@material-ui/core/Avatar';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { useQuery } from '@apollo/react-hooks';
import { MeQuery } from '../types';
import gql from 'graphql-tag';

interface LayoutProps {
	children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
	const { data } = useQuery<MeQuery>(gql`
		query Me {
			me {
				name
				avatarUrl
			}
		}
	`);

	return (
		<>
			<AppBar position='relative'>
				<Toolbar>
					<Box mr={2}>
						<Link href={'/'} passHref>
							<Button color='inherit'>
								<Avatar alt='Remy Sharp' src={data?.me.avatarUrl} />
								&nbsp;&nbsp;&nbsp;
								<Typography variant='h6'>{data?.me.name}</Typography>
							</Button>
						</Link>
					</Box>

					<Tabs value={0} aria-label='disabled tabs example'>
						<Link href={'/'} passHref>
							<Tab component={'a'} label='Queues' />
						</Link>
					</Tabs>
				</Toolbar>
			</AppBar>
			<Container maxWidth={'lg'}>
				<Paper elevation={3}>
					<Box mt={4} p={4}>
						{children}
					</Box>
				</Paper>
			</Container>
		</>
	);
};

export default Layout;
