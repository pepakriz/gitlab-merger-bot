import React from 'react';
import { withApollo } from '../lib/apollo';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Layout from '../components/layout';
import { useSubscription } from '@apollo/client';
import gql from 'graphql-tag';
import OverlayLoading from '../components/ui/overlay-loading';
import { GetWebHookHistorySubscriptionSubscription } from '../types';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Icon from '@mui/icons-material/Send';
import { Collapse } from '@mui/material';
import { KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material';

const intl = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	second: 'numeric',
});

const Row = ({
	webHookHistory,
}: {
	webHookHistory: GetWebHookHistorySubscriptionSubscription['webHookHistory'][number];
}) => {
	const [open, setOpen] = React.useState(false);

	return (
		<>
			<TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
				<TableCell component='th'>
					{intl.format(new Date(webHookHistory.createdAt * 1000))}
				</TableCell>
				<TableCell component='th'>{webHookHistory.status}</TableCell>
				<TableCell component='th'>{webHookHistory.event}</TableCell>
				<TableCell component='th'>
					{webHookHistory.data && webHookHistory.data.substr(0, 50)}
				</TableCell>
				<TableCell component='th'>
					<Button aria-label='expand row' size='small' onClick={() => setOpen(!open)}>
						{open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
					</Button>
				</TableCell>
			</TableRow>
			<TableRow>
				<TableCell
					sx={{ paddingBottom: 0, paddingTop: 0, overflow: 'auto', maxHeight: '400px' }}
					colSpan={5}
				>
					<Collapse in={open} timeout='auto' unmountOnExit>
						{webHookHistory.data && (
							<small>
								<pre style={{ maxHeight: '600px' }}>
									{JSON.stringify(JSON.parse(webHookHistory.data), null, 2)}
								</pre>
							</small>
						)}
					</Collapse>
				</TableCell>
			</TableRow>
		</>
	);
};

const App = () => {
	const { loading, error, data } = useSubscription<GetWebHookHistorySubscriptionSubscription>(gql`
		subscription GetWebHookHistorySubscription {
			webHookHistory {
				id
				createdAt
				data
				event
				status
			}
		}
	`);

	return (
		<>
			<Typography variant={'h3'}>Web Hook History</Typography>
			<Box mt={4}>
				{loading ? (
					<OverlayLoading />
				) : (
					<TableContainer component={Paper}>
						<Table size='small'>
							<TableHead>
								<TableRow>
									<TableCell>Created at</TableCell>
									<TableCell>Status</TableCell>
									<TableCell>Event</TableCell>
									<TableCell>Data</TableCell>
									<TableCell></TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{data?.webHookHistory.map((webHookHistory) => (
									<Row key={webHookHistory.id} webHookHistory={webHookHistory} />
								))}
							</TableBody>
						</Table>
					</TableContainer>
				)}
			</Box>
		</>
	);
};

App.getLayout = Layout;

export default App;
