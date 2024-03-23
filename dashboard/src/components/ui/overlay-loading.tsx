import React from 'react';

import CircularProgress from '@mui/material/CircularProgress';
import Backdrop from '@mui/material/Backdrop';
import { Theme } from '@mui/material';

const OverlayLoading = () => {
	return (
		<Backdrop
			open
			sx={{
				zIndex: (theme: Theme) => theme.zIndex.appBar - 1,
				color: '#fff',
			}}
		>
			<CircularProgress size={32} color={'inherit'} />
		</Backdrop>
	);
};

export default OverlayLoading;
