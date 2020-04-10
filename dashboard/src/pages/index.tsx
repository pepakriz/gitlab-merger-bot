import React from 'react';
import { withApollo } from '../lib/apollo';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';
import Layout from '../components/layout';
import { useSubscription } from '@apollo/react-hooks';
import gql from 'graphql-tag';
import OverlayLoading from '../components/ui/overlay-loading';
import { GetQueuesSubscriptionJobFragment, GetQueuesSubscriptionSubscription } from '../types';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableContainer from '@material-ui/core/TableContainer';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Paper from '@material-ui/core/Paper';
import Button from '@material-ui/core/Button';
import Toolbar from '@material-ui/core/Toolbar';
import Icon from '@material-ui/icons/Send';
import { UserAvatar } from '../components/ui/UserAvatar';

const Row = (job: GetQueuesSubscriptionJobFragment) => (
	<TableRow key={job.info.mergeRequest.iid}>
		<TableCell component='th'>
			<UserAvatar userId={job.info.mergeRequest.authorId} />
		</TableCell>
		<TableCell component='th' scope='row'>
			<a href={job.info.mergeRequest.webUrl} target={'_blank'}>
				{job.info.mergeRequest.iid}: {job.info.mergeRequest.title}
			</a>
		</TableCell>
		<TableCell align='right'>Normal</TableCell>
		<TableCell align='right'>{job.status}</TableCell>
		<TableCell align='right'>
			<Button
				variant='contained'
				endIcon={<Icon>send</Icon>}
				color='primary'
				onClick={() => window.open(job.info.mergeRequest.webUrl, '_blank')}
			>
				Open
			</Button>
		</TableCell>
	</TableRow>
);

const App = () => {
	const { loading, error, data } = useSubscription<GetQueuesSubscriptionSubscription>(gql`
		fragment GetQueuesSubscriptionJob on Job {
			status
			info {
				mergeRequest {
					iid
					projectId
					authorId
					title
					webUrl
				}
			}
		}

		subscription GetQueuesSubscription {
			queues {
				name
				info {
					projectName
				}
				high {
					...GetQueuesSubscriptionJob
				}
				normal {
					...GetQueuesSubscriptionJob
				}
			}
		}
	`);

	return (
		<Layout>
			<Typography variant={'h3'}>Queues</Typography>
			<Box mt={4}>
				{loading ? (
					<OverlayLoading />
				) : (
					data?.queues.map((queue) => (
						<Paper>
							<Toolbar>
								<Typography variant={'h6'}>
									{queue.info.projectName} <small>(ID: {queue.name})</small>
								</Typography>
							</Toolbar>

							<TableContainer component={Paper} key={queue.name}>
								<Table size='small' aria-label={queue.name}>
									<TableHead>
										<TableRow>
											<TableCell></TableCell>
											<TableCell>Title</TableCell>
											<TableCell align='right'>Priority</TableCell>
											<TableCell align='right'>Status</TableCell>
											<TableCell align='right'>Actions</TableCell>
										</TableRow>
									</TableHead>
									<TableBody>
										{queue.high.map(Row)}
										{queue.normal.map(Row)}
									</TableBody>
								</Table>
							</TableContainer>
						</Paper>
					))
				)}
			</Box>
		</Layout>
	);
};

export default withApollo(App);
