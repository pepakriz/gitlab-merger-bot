import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import React from 'react';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Avatar from '@mui/material/Avatar';
import { useQuery } from '@apollo/client';
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
					<Avatar alt='Remy Sharp' src={data?.me.avatarUrl} />
					&nbsp;&nbsp;&nbsp;
					<Typography variant='h6'>{data?.me.name}</Typography>
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
