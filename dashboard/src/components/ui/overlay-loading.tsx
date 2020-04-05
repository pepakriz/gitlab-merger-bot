import React from 'react';

import CircularProgress from '@material-ui/core/CircularProgress';
import Backdrop from '@material-ui/core/Backdrop';
import { makeStyles, createStyles, Theme } from '@material-ui/core';

const useStyles = makeStyles((theme: Theme) =>
	createStyles({
		backdrop: {
			zIndex: theme.zIndex.appBar - 1,
			color: '#fff',
		},
	}),
);

const OverlayLoading = () => {
	const classes = useStyles();
	return (
		<Backdrop open className={classes.backdrop}>
			<CircularProgress size={32} color={'inherit'} />
		</Backdrop>
	);
};

export default OverlayLoading;
