import React from 'react';
import { withApollo } from '../lib/apollo';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Layout from '../components/layout';
import { useMutation, useSubscription } from '@apollo/client';
import gql from 'graphql-tag';
import OverlayLoading from '../components/ui/overlay-loading';
import {
	GetQueuesSubscriptionJobFragment,
	GetQueuesSubscriptionSubscription,
	UnassignMutation,
	UnassignMutationVariables,
} from '../types';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Toolbar from '@mui/material/Toolbar';
import Icon from '@mui/icons-material/Send';
import { UserAvatar } from '../components/ui/UserAvatar';
import CircularProgress from '@mui/material/CircularProgress';

const Row = (props: GetQueuesSubscriptionJobFragment) => {
	const [unassign, { loading }] = useMutation<UnassignMutation, UnassignMutationVariables>(gql`
		mutation Unassign($input: UnassignInput!) {
			unassign(input: $input)
		}
	`);
	return (
		<TableRow key={props.info.mergeRequest.iid}>
			<TableCell component='th'>
				<UserAvatar userId={props.info.mergeRequest.authorId} />
			</TableCell>
			<TableCell component='th' scope='row'>
				<a href={props.info.mergeRequest.webUrl} target={'_blank'}>
					{props.info.mergeRequest.iid}: {props.info.mergeRequest.title}
				</a>
			</TableCell>
			<TableCell align='right'>{props.priority}</TableCell>
			<TableCell align='right'>{props.status}</TableCell>
			<TableCell align='right'>
				<ButtonGroup variant='contained' aria-label='contained primary button group'>
					<Button
						variant='contained'
						disabled={loading}
						onClick={() =>
							unassign({
								variables: {
									input: {
										projectId: props.info.mergeRequest.projectId,
										mergeRequestIid: props.info.mergeRequest.iid,
									},
								},
							})
						}
					>
						Unassign
						{loading && (
							<CircularProgress
								size={24}
								style={{ left: '50%', position: 'absolute', marginLeft: '-12px' }}
							/>
						)}
					</Button>
					<Button
						variant='contained'
						endIcon={<Icon>send</Icon>}
						color='primary'
						onClick={() => window.open(props.info.mergeRequest.webUrl, '_blank')}
					>
						Open
					</Button>
				</ButtonGroup>
			</TableCell>
		</TableRow>
	);
};

const App = () => {
	const { loading, error, data } = useSubscription<GetQueuesSubscriptionSubscription>(gql`
		fragment GetQueuesSubscriptionJob on Job {
			status
			priority
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
				jobs {
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
										{queue.jobs.map((props) => (
											<Row {...props} key={props.info.mergeRequest.iid}></Row>
										))}
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
